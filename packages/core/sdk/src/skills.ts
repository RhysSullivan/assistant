// ---------------------------------------------------------------------------
// Skills — first-class storage for "runbook notes" keyed to a source
// (an integration the user has hooked up: an MCP server, an OpenAPI spec,
// etc.). The recurring pain this fixes:
//
//   1. User hooks up a new integration.
//   2. User asks the model to run a test case against it.
//   3. The model learns API quirks (auth edge cases, pagination shape,
//      required headers, error messages).
//   4. Today that knowledge is thrown away.
//
// The smallest reasonable primitive here is a scoped row keyed by
// (scope, source_id, id) that carries a human-readable markdown body.
// On future invocations, agents see the skill first via
// `executor.skills.listForSource(sourceId)` or via the static `record`
// tool's sibling `list` tool, and skip re-learning.
//
// Where it lives:
//  - Table: `skill` in `coreSchema` — skills cut across plugins. A skill
//    belongs to a Source (plugin-agnostic id), not to any one plugin's
//    private store. Putting it in the core schema means every host
//    (CLI, MCP server, react app) sees the same table without each
//    having to thread a `skills` plugin through config.
//  - API: `executor.skills.*` for host code; `ctx.core.skills.*` for
//    plugin-owned tool handlers that want to inline a `record()`.
//  - Tool surface: a built-in static plugin (`skillsPlugin`, auto-
//    prepended by `createExecutor`) exposes `executor.skills.record`,
//    `executor.skills.list`, `executor.skills.delete` as tools so
//    models can call them directly.
//
// Size caps: `body` is clamped to MAX_SKILL_BODY_BYTES at write time
// and each source is capped at MAX_SKILLS_PER_SOURCE most-recent rows
// on read. This keeps the consume path ("load all skills and prepend
// to the system prompt") bounded regardless of how chatty the model is.
// ---------------------------------------------------------------------------

import { Effect, Schema } from "effect";
import type { StorageFailure, TypedAdapter } from "@executor/storage-core";

import type { CoreSchema, SkillRow } from "./core-schema";

// ---------------------------------------------------------------------------
// Caps. Hard-coded because this is a "small correct primitive" — tuning
// knobs can be added once real usage signals a need.
// ---------------------------------------------------------------------------

/** Max UTF-8 bytes for a single skill body. Longer input is truncated
 *  with a trailing marker; this is a correctness floor, not a policy. */
export const MAX_SKILL_BODY_BYTES = 8 * 1024;
/** Cap applied to the per-source list at read time. Newest first. */
export const MAX_SKILLS_PER_SOURCE = 16;

// ---------------------------------------------------------------------------
// Public projection. Returned by `executor.skills.*`.
// ---------------------------------------------------------------------------

export class Skill extends Schema.Class<Skill>("Skill")({
  id: Schema.String,
  sourceId: Schema.String,
  scopeId: Schema.String,
  title: Schema.String,
  body: Schema.String,
  createdBy: Schema.Literal("model", "user"),
  version: Schema.Number,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
}) {}

export interface RecordSkillInput {
  /** Source this skill belongs to — an entry in `executor.sources.list()`. */
  readonly sourceId: string;
  /** Stable id. If an existing row with this id exists (at this scope),
   *  the record is overwritten and `version` is bumped. If omitted, a
   *  fresh id is minted from the title. */
  readonly id?: string;
  readonly title: string;
  readonly body: string;
  /** Defaults to "model". Hosts that call record() on behalf of the
   *  user should override to "user". */
  readonly createdBy?: "model" | "user";
  /** Target scope. Defaults to innermost scope of the executor's stack
   *  so per-user skills don't leak across tenants. */
  readonly scope?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64) || "skill";

const clampBody = (body: string): string => {
  // Byte-length check, not code-unit length, so mostly-ASCII and
  // mostly-emoji bodies both hit the same structural cap.
  const encoded = new TextEncoder().encode(body);
  if (encoded.byteLength <= MAX_SKILL_BODY_BYTES) return body;
  const sliced = encoded.slice(0, MAX_SKILL_BODY_BYTES - 32);
  return new TextDecoder().decode(sliced) + "\n\n[truncated]";
};

const rowToSkill = (row: SkillRow): Skill =>
  new Skill({
    id: row.id as string,
    sourceId: row.source_id as string,
    scopeId: row.scope_id as string,
    title: row.title as string,
    body: row.body as string,
    createdBy: ((row.created_by as string) === "user" ? "user" : "model") as
      | "model"
      | "user",
    version: Number(row.version ?? 1),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  });

// ---------------------------------------------------------------------------
// Store — pure data-access layer used by both the executor surface and the
// plugin-facing ctx.core.skills bridge. Takes a resolved scope string so
// callers don't have to thread scopes through every function.
// ---------------------------------------------------------------------------

export interface SkillsStore {
  readonly record: (
    input: RecordSkillInput & { readonly scope: string },
  ) => Effect.Effect<Skill, StorageFailure>;
  readonly listForSource: (
    sourceId: string,
  ) => Effect.Effect<readonly Skill[], StorageFailure>;
  readonly list: () => Effect.Effect<readonly Skill[], StorageFailure>;
  readonly remove: (id: string) => Effect.Effect<void, StorageFailure>;
}

export const makeSkillsStore = (
  core: TypedAdapter<CoreSchema, StorageFailure>,
  scopeRank: (row: { scope_id: unknown }) => number,
): SkillsStore => {
  const record: SkillsStore["record"] = (input) =>
    Effect.gen(function* () {
      const now = new Date();
      const id = input.id ?? `${slug(input.title)}-${now.getTime()}`;
      const body = clampBody(input.body);
      const createdBy = input.createdBy ?? "model";

      const existingRows = yield* core.findMany({
        model: "skill",
        where: [
          { field: "id", value: id },
          { field: "source_id", value: input.sourceId },
        ],
      });
      // Overwrite must target the same (id, scope) row — don't silently
      // bump an outer-scope skill's version from an inner-scope caller.
      const existing = existingRows.find(
        (r) => (r.scope_id as string) === input.scope,
      );

      if (existing) {
        const nextVersion = Number(existing.version ?? 1) + 1;
        yield* core.updateMany({
          model: "skill",
          where: [
            { field: "id", value: id },
            { field: "scope_id", value: input.scope },
          ],
          update: {
            title: input.title,
            body,
            created_by: createdBy,
            version: nextVersion,
            updated_at: now,
          },
        });
        return rowToSkill({
          ...(existing as SkillRow),
          title: input.title,
          body,
          created_by: createdBy,
          version: nextVersion,
          updated_at: now,
        });
      }

      const row = yield* core.create({
        model: "skill",
        data: {
          id,
          scope_id: input.scope,
          source_id: input.sourceId,
          title: input.title,
          body,
          created_by: createdBy,
          version: 1,
          created_at: now,
          updated_at: now,
        },
        forceAllowId: true,
      });
      return rowToSkill(row as SkillRow);
    });

  // Innermost-scope wins on id collisions so a user's scope shadow takes
  // precedence over an org-wide skill with the same id — same convention
  // as sources / tools / connections.
  const dedupInnermost = (rows: readonly SkillRow[]): SkillRow[] => {
    const byId = new Map<string, { row: SkillRow; rank: number }>();
    for (const row of rows) {
      const rank = scopeRank(row);
      const existing = byId.get(row.id as string);
      if (!existing || rank < existing.rank) {
        byId.set(row.id as string, { row, rank });
      }
    }
    return [...byId.values()].map((v) => v.row);
  };

  const listForSource: SkillsStore["listForSource"] = (sourceId) =>
    Effect.gen(function* () {
      const rows = yield* core.findMany({
        model: "skill",
        where: [{ field: "source_id", value: sourceId }],
      });
      const deduped = dedupInnermost(rows);
      // Newest first, then hard-cap.
      deduped.sort(
        (a, b) =>
          (b.updated_at as Date).getTime() - (a.updated_at as Date).getTime(),
      );
      return deduped.slice(0, MAX_SKILLS_PER_SOURCE).map(rowToSkill);
    });

  const list: SkillsStore["list"] = () =>
    Effect.gen(function* () {
      const rows = yield* core.findMany({ model: "skill" });
      const deduped = dedupInnermost(rows);
      deduped.sort(
        (a, b) =>
          (b.updated_at as Date).getTime() - (a.updated_at as Date).getTime(),
      );
      return deduped.map(rowToSkill);
    });

  const remove: SkillsStore["remove"] = (id) =>
    core
      .deleteMany({ model: "skill", where: [{ field: "id", value: id }] })
      .pipe(Effect.asVoid);

  return { record, listForSource, list, remove };
};

// ---------------------------------------------------------------------------
// JSON schemas for the static tool surface. Kept minimal — just the shape
// the agent-facing tools expose.
// ---------------------------------------------------------------------------

export const recordSkillInputSchema = {
  type: "object",
  properties: {
    sourceId: { type: "string", description: "Source id this skill applies to" },
    title: { type: "string" },
    body: {
      type: "string",
      description:
        "Markdown body. Succinct runbook-style notes about the integration: auth quirks, required headers, pagination shape, error recovery.",
    },
    id: {
      type: "string",
      description:
        "Optional stable id. Pass the id returned by a previous record() call to overwrite; omit to mint a fresh one.",
    },
  },
  required: ["sourceId", "title", "body"],
  additionalProperties: false,
} as const;

export const listSkillsInputSchema = {
  type: "object",
  properties: {
    sourceId: {
      type: "string",
      description:
        "Only return skills for this source. Omit to list every skill across every integration.",
    },
  },
  additionalProperties: false,
} as const;

export const deleteSkillInputSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

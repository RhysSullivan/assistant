// ---------------------------------------------------------------------------
// Workspaces handlers — wired into OrgHttpApi (OrgAuth-gated)
// ---------------------------------------------------------------------------

import { HttpApiBuilder } from "effect/unstable/httpapi";
import { Effect } from "effect";

import { AuthContext } from "../auth/middleware";
import { DbService } from "../services/db";
import { slugifyHandle } from "../services/ids";
import { makeWorkspaceStore, type Workspace } from "../services/workspace-store";
import { OrgHttpApi } from "../org/compose";
import { InvalidWorkspaceName, WorkspaceNotFound } from "./api";

const NAME_MAX = 96;
const SLUG_MAX = 48;

const toResponse = (row: Workspace) => ({
  id: row.id,
  organizationId: row.organizationId,
  slug: row.slug,
  name: row.name,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const WorkspacesHandlers = HttpApiBuilder.group(
  OrgHttpApi,
  "workspaces",
  (handlers) =>
    handlers
      .handle("listWorkspaces", () =>
        Effect.gen(function* () {
          const auth = yield* AuthContext;
          const { db } = yield* DbService;
          const rows = yield* Effect.promise(() =>
            makeWorkspaceStore(db).list(auth.organizationId),
          );
          return { workspaces: rows.map(toResponse) };
        }),
      )
      .handle("createWorkspace", ({ payload }) =>
        Effect.gen(function* () {
          const trimmed = payload.name.trim();
          if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
            return yield* new InvalidWorkspaceName({
              reason: "name must be 1–96 characters after trimming",
            });
          }
          if (slugifyHandle(trimmed) === "org" && !/[a-z0-9]/i.test(trimmed)) {
            return yield* new InvalidWorkspaceName({
              reason: "name must contain a letter or digit",
            });
          }
          if (payload.slug && payload.slug.length > SLUG_MAX) {
            return yield* new InvalidWorkspaceName({
              reason: "slug must be at most 48 characters",
            });
          }
          const auth = yield* AuthContext;
          const { db } = yield* DbService;
          const row = yield* Effect.promise(() =>
            makeWorkspaceStore(db).create({
              organizationId: auth.organizationId,
              name: trimmed,
              slug: payload.slug,
            }),
          );
          return toResponse(row);
        }),
      )
      .handle("getWorkspace", ({ params }) =>
        Effect.gen(function* () {
          const auth = yield* AuthContext;
          const { db } = yield* DbService;
          const row = yield* Effect.promise(() =>
            makeWorkspaceStore(db).getBySlug(auth.organizationId, params.slug),
          );
          if (!row) return yield* new WorkspaceNotFound();
          return toResponse(row);
        }),
      ),
);

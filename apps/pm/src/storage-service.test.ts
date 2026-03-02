import { describe, expect, it } from "@effect/vitest";
import { type SqlControlPlanePersistence } from "@executor-v2/persistence-sql";
import {
  type OrganizationId,
  type StorageInstance,
  type WorkspaceId,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { createPmStorageService } from "./storage-service";

type StorageRows = Pick<
  SqlControlPlanePersistence["rows"],
  "workspaces" | "storageInstances"
>;

describe("PM storage service", () => {
  it.effect("opens, inspects, queries, and removes storage instances", () =>
    Effect.gen(function* () {
      const stateRootDir = yield* Effect.promise(() =>
        mkdtemp(path.join(tmpdir(), "executor-v2-pm-storage-")),
      );

      const workspaceId = "ws_local" as WorkspaceId;
      const workspace = {
        id: workspaceId,
        organizationId: "org_local" as OrganizationId,
        name: "Local Workspace",
        createdByAccountId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const storageInstances: Array<StorageInstance> = [];

      const rows: StorageRows = {
        workspaces: {
          list: () => Effect.succeed([workspace]),
          getById: (id) =>
            Effect.succeed(id === workspace.id ? Option.some(workspace) : Option.none()),
          listByOrganizationIds: (organizationIds) =>
            Effect.succeed(
              organizationIds.includes(workspace.organizationId) ? [workspace] : [],
            ),
          upsert: () => Effect.void,
        },
        storageInstances: {
          list: () => Effect.succeed(storageInstances),
          getById: (storageInstanceId) =>
            Effect.succeed(
              Option.fromNullable(
                storageInstances.find((item) => item.id === storageInstanceId) ?? null,
              ),
            ),
          listByWorkspaceScope: (scopeWorkspaceId, organizationId) =>
            Effect.succeed(
              storageInstances.filter((instance) =>
                instance.workspaceId === scopeWorkspaceId
                || (
                  instance.workspaceId === null
                  && instance.organizationId === organizationId
                )
              ),
            ),
          upsert: (storageInstance) =>
            Effect.sync(() => {
              const index = storageInstances.findIndex((item) => item.id === storageInstance.id);
              if (index >= 0) {
                storageInstances[index] = storageInstance;
                return;
              }

              storageInstances.push(storageInstance);
            }),
          removeById: (storageInstanceId) =>
            Effect.sync(() => {
              const index = storageInstances.findIndex((item) => item.id === storageInstanceId);
              if (index < 0) {
                return false;
              }

              storageInstances.splice(index, 1);
              return true;
            }),
        },
      };

      const service = createPmStorageService(rows, {
        stateRootDir,
      });

      const storageInstance = yield* service.openStorageInstance({
        workspaceId,
        payload: {
          scopeType: "workspace",
          durability: "ephemeral",
          ttlHours: 24,
        },
      });

      expect(storageInstance.status).toBe("active");

      const listed = yield* service.listStorageInstances(workspaceId);
      expect(listed).toHaveLength(1);

      const directoryBeforeWrite = yield* service.listStorageDirectory({
        workspaceId,
        storageInstanceId: storageInstance.id,
        payload: {
          path: "/",
        },
      });
      expect(directoryBeforeWrite.entries).toHaveLength(0);

      const storageFsPath = path.resolve(
        stateRootDir,
        "storage",
        storageInstance.id,
        "fs",
        "hello.txt",
      );

      yield* Effect.promise(() =>
        writeFile(storageFsPath, "hello from storage", "utf8"),
      );

      const directoryAfterWrite = yield* service.listStorageDirectory({
        workspaceId,
        storageInstanceId: storageInstance.id,
        payload: {
          path: "/",
        },
      });
      expect(directoryAfterWrite.entries.some((entry) => entry.name === "hello.txt")).toBe(
        true,
      );

      const filePreview = yield* service.readStorageFile({
        workspaceId,
        storageInstanceId: storageInstance.id,
        payload: {
          path: "/hello.txt",
          encoding: "utf8",
        },
      });
      expect(filePreview.content).toBe("hello from storage");

      const kvResult = yield* service.listStorageKv({
        workspaceId,
        storageInstanceId: storageInstance.id,
        payload: {
          prefix: "",
          limit: 20,
        },
      });
      expect(kvResult.items).toHaveLength(0);

      const closedStorage = yield* service.closeStorageInstance({
        workspaceId,
        storageInstanceId: storageInstance.id,
      });
      expect(closedStorage.status).toBe("closed");

      const removed = yield* service.removeStorageInstance({
        workspaceId,
        storageInstanceId: storageInstance.id,
      });
      expect(removed.removed).toBe(true);

      const listedAfterRemove = yield* service.listStorageInstances(workspaceId);
      expect(listedAfterRemove).toHaveLength(0);

      yield* Effect.promise(() =>
        rm(stateRootDir, { recursive: true, force: true }),
      );
    }),
  );
});

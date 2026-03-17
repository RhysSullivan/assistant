import { describe, expect, it } from "@effect/vitest";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import {
  SourceInspectionToolDetailSchema,
  StoredSourceCatalogRevisionRecordSchema,
} from "./index";

describe("control-plane-schema", () => {
  it("accepts snapshot-native inspection detail rows", () => {
    const decode = Schema.decodeUnknownEither(SourceInspectionToolDetailSchema);

    const detail = decode({
      summary: {
        path: "github.issues.list",
        sourceKey: "src_1",
        protocol: "http",
        toolId: "list",
        rawToolId: "issues.list",
        operationId: "listIssues",
        group: "issues",
        leaf: "list",
        tags: ["issues"],
        method: "GET",
        pathTemplate: "/issues",
      },
      sections: [{
        kind: "facts",
        title: "Overview",
        items: [{
          label: "Protocol",
          value: "http",
          mono: true,
        }],
      }, {
        kind: "code",
        title: "Executable",
        language: "json",
        body: "{}",
      }],
    });

    expect(Either.isRight(detail)).toBe(true);
  });

  it("rejects malformed catalog revisions", () => {
    const decode = Schema.decodeUnknownEither(StoredSourceCatalogRevisionRecordSchema);

    const invalidRevision = decode({
      id: "src_catalog_rev_1",
      catalogId: "src_catalog_1",
      revisionNumber: "1",
      sourceConfigJson: "{}",
      importMetadataJson: null,
      importMetadataHash: null,
      snapshotHash: null,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(Either.isLeft(invalidRevision)).toBe(true);
  });
});

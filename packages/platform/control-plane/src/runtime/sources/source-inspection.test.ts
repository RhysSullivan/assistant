import { describe, expect, it } from "@effect/vitest";

import type { LoadedSourceCatalogTool } from "../catalog/source/runtime";
import { inspectionToolDetailFromTool } from "./source-inspection";

describe("source inspection", () => {
  it("keeps tool detail lightweight by default", () => {
    const detail = inspectionToolDetailFromTool({
      path: "linear.administrableTeams",
      source: {
        id: "linear",
      },
      capability: {
        surface: {
          title: "Administrable Teams",
          summary: "All teams the user can administrate.",
          description: "All teams the user can administrate.",
          tags: ["query"],
        },
        native: [],
      },
      executable: {
        id: "exec_graphql_administrableTeams",
        adapterKey: "graphql",
        bindingVersion: 1,
        binding: {
          operationKind: "query",
          rootTypeName: "Query",
          fieldName: "administrableTeams",
        },
        projection: {
          callShapeId: "shape_call",
          resultShapeId: "shape_result",
        },
        display: {
          protocol: "graphql",
          method: "query",
          pathTemplate: "administrableTeams",
          operationId: "administrableTeams",
          group: "query",
          leaf: "administrableTeams",
          rawToolId: "administrableTeams",
        },
        native: [],
      },
      projectedDescriptor: {
        toolPath: ["linear", "administrableTeams"],
        callShapeId: "shape_call",
        resultShapeId: "shape_result",
      },
      descriptor: {},
    } as LoadedSourceCatalogTool);

    expect(detail.summary.path).toBe("linear.administrableTeams");
    expect(detail.summary.method).toBe("query");

    const sectionTitles = detail.sections.map((section) => section.title);
    expect(sectionTitles).not.toContain("Input Type");
    expect(sectionTitles).not.toContain("Output Type");
    expect(sectionTitles).not.toContain("Input Schema");
    expect(sectionTitles).not.toContain("Output Schema");

    const overview = detail.sections.find((section) => section.kind === "facts");
    expect(overview).toBeDefined();
    expect(overview?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Call shape", value: "shape_call" }),
        expect.objectContaining({ label: "Result shape", value: "shape_result" }),
      ]),
    );
  });
});

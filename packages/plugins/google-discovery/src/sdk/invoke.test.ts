import { describe, expect, it } from "@effect/vitest";

import { annotationsForOperation } from "./invoke";

// ---------------------------------------------------------------------------
// Pure tests for the Google Discovery annotation helper. Exercises the
// default (POST / PUT / PATCH / DELETE) policy plus per-source overrides
// supplied via `GoogleDiscoveryAnnotationPolicy.requireApprovalFor`.
// ---------------------------------------------------------------------------

describe("annotationsForOperation", () => {
  it("applies the default policy when no override is supplied", () => {
    const post = annotationsForOperation("post", "/foo", undefined);
    expect(post.requiresApproval).toBe(true);
    expect(post.approvalDescription).toBe("POST /foo");

    const get = annotationsForOperation("get", "/foo", undefined);
    expect(get.requiresApproval).toBeUndefined();
    expect(get.approvalDescription).toBeUndefined();
  });

  it("honors overrides that include GET", () => {
    const result = annotationsForOperation("get", "/foo", {
      requireApprovalFor: ["get"],
    });
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalDescription).toBe("GET /foo");
  });

  it("honors overrides that exclude POST", () => {
    const result = annotationsForOperation("post", "/foo", {
      requireApprovalFor: ["get"],
    });
    expect(result.requiresApproval).toBeUndefined();
    expect(result.approvalDescription).toBeUndefined();
  });

  it("treats an empty override as approval-for-nothing", () => {
    const result = annotationsForOperation("delete", "/foo", {
      requireApprovalFor: [],
    });
    expect(result.requiresApproval).toBeUndefined();
    expect(result.approvalDescription).toBeUndefined();
  });

  it("treats a null policy the same as undefined (fall back to defaults)", () => {
    const post = annotationsForOperation("post", "/foo", null);
    expect(post.requiresApproval).toBe(true);
    const get = annotationsForOperation("get", "/foo", null);
    expect(get.requiresApproval).toBeUndefined();
  });
});

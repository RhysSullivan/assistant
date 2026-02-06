import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { describe } from "vitest";
import {
  createCodeModeRunner,
  defineTool,
} from "./runner.js";

describe("codemode runner", () => {
  it.effect("runs read tools without approval", () =>
    Effect.gen(function* () {
      const approvalCalls: Array<{ toolPath: string }> = [];
      const runner = createCodeModeRunner({
        tools: {
          calendar: {
            read: defineTool({
              kind: "read",
              approval: "auto",
              run: (input: { id: string }) => Effect.succeed({ id: input.id }),
            }),
          },
        },
        requestApproval: (request) =>
          Effect.sync(() => {
            approvalCalls.push({ toolPath: request.toolPath });
            return "approved" as const;
          }),
      });

      const result = yield* runner.run({
        code: "const event = await tools.calendar.read({ id: 'evt_1' }); return event.id;",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("evt_1");
      }
      expect(approvalCalls).toHaveLength(0);
      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0]?.decision).toBe("auto");
      expect(result.receipts[0]?.status).toBe("succeeded");
      expect(result.receipts[0]?.toolPath).toBe("calendar.read");
    }),
  );

  it.effect("blocks writes when denied and records receipt", () =>
    Effect.gen(function* () {
      let ranMutation = false;
      const runner = createCodeModeRunner({
        tools: {
          calendar: {
            update: defineTool({
              kind: "write",
              approval: "required",
              run: (_input: { id: string }) =>
                Effect.sync(() => {
                  ranMutation = true;
                  return { ok: true };
                }),
            }),
          },
        },
        requestApproval: () => Effect.succeed("denied" as const),
      });

      const result = yield* runner.run({
        code: "await tools.calendar.update({ id: 'evt_2' }); return 'done';",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("denied");
      }
      expect(ranMutation).toBe(false);
      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0]?.decision).toBe("denied");
      expect(result.receipts[0]?.status).toBe("denied");
      expect(result.receipts[0]?.toolPath).toBe("calendar.update");
    }),
  );

  it.effect("runs three writes with three approval requests and three success receipts", () =>
    Effect.gen(function* () {
      let ranMutations = 0;
      const approvalCalls: Array<{ toolPath: string }> = [];
      const runner = createCodeModeRunner({
        tools: {
          calendar: {
            update: defineTool({
              kind: "write",
              approval: "required",
              run: (input: { id: string; title: string }) =>
                Effect.sync(() => {
                  ranMutations += 1;
                  return { id: input.id, title: input.title };
                }),
            }),
          },
        },
        requestApproval: (request) =>
          Effect.sync(() => {
            approvalCalls.push({ toolPath: request.toolPath });
            return "approved" as const;
          }),
      });

      const result = yield* runner.run({
        code: `
const first = await tools.calendar.update({ id: 'evt_3', title: 'Dinner' });
const second = await tools.calendar.update({ id: 'evt_4', title: 'Lunch' });
const third = await tools.calendar.update({ id: 'evt_5', title: 'Breakfast' });
return [first.title, second.title, third.title];
`,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(["Dinner", "Lunch", "Breakfast"]);
      }
      expect(ranMutations).toBe(3);
      expect(approvalCalls).toHaveLength(3);
      expect(approvalCalls.map((call) => call.toolPath)).toEqual([
        "calendar.update",
        "calendar.update",
        "calendar.update",
      ]);
      expect(result.receipts).toHaveLength(3);
      for (const receipt of result.receipts) {
        expect(receipt.decision).toBe("approved");
        expect(receipt.status).toBe("succeeded");
        expect(receipt.toolPath).toBe("calendar.update");
      }
    }),
  );

  it.effect("continues after one denied write and still requests approval for subsequent writes", () =>
    Effect.gen(function* () {
      let ranMutations = 0;
      const approvalDecisions: Array<"approved" | "denied"> = ["denied", "approved"];
      const approvalCalls: Array<{ toolPath: string }> = [];

      const runner = createCodeModeRunner({
        tools: {
          calendar: {
            update: defineTool({
              kind: "write",
              approval: "required",
              run: (input: { id: string; title: string }) =>
                Effect.sync(() => {
                  ranMutations += 1;
                  return { id: input.id, title: input.title };
                }),
            }),
          },
        },
        requestApproval: (request) =>
          Effect.sync(() => {
            approvalCalls.push({ toolPath: request.toolPath });
            return approvalDecisions.shift() ?? "approved";
          }),
      });

      const result = yield* runner.run({
        code: `
const first = await tools.calendar.update({ id: 'evt_10', title: 'Denied first' });
const second = await tools.calendar.update({ id: 'evt_11', title: 'Approved second' });
return { first, second };
`,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("denied");
      }
      expect(approvalCalls).toHaveLength(2);
      expect(ranMutations).toBe(1);
      expect(result.receipts).toHaveLength(2);
      expect(result.receipts[0]?.status).toBe("denied");
      expect(result.receipts[1]?.status).toBe("succeeded");
      expect(result.receipts[0]?.decision).toBe("denied");
      expect(result.receipts[1]?.decision).toBe("approved");
    }),
  );
});

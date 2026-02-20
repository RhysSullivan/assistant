import { z } from "zod";

const graphqlObjectInputSchema = z.object({
  query: z.string().optional(),
  variables: z.unknown().optional(),
}).catchall(z.unknown());

const graphqlInvocationInputSchema = z.union([
  z.string(),
  graphqlObjectInputSchema,
]);

const recordSchema = z.record(z.unknown());

function toRecord(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function normalizeGraphqlInvocationInput(input: unknown): {
  payload: Record<string, unknown>;
  query: string;
  variables: unknown;
  hasExplicitQuery: boolean;
} {
  const parsedInput = graphqlInvocationInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const payload = toRecord(input);
    return {
      payload,
      query: "",
      variables: payload.variables,
      hasExplicitQuery: false,
    };
  }

  if (typeof parsedInput.data === "string") {
    const query = parsedInput.data.trim();
    return {
      payload: { query: parsedInput.data },
      query,
      variables: undefined,
      hasExplicitQuery: query.length > 0,
    };
  }

  const query = (parsedInput.data.query ?? "").trim();
  return {
    payload: parsedInput.data,
    query,
    variables: parsedInput.data.variables,
    hasExplicitQuery: query.length > 0,
  };
}

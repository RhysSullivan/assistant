import type { ScopeId } from "@executor/storage";
import { GraphqlClient } from "./client";

// ---------------------------------------------------------------------------
// Query atoms
// ---------------------------------------------------------------------------

export const graphqlSourceAtom = (scopeId: ScopeId, namespace: string) =>
  GraphqlClient.query("graphql", "getSource", {
    path: { scopeId, namespace },
    timeToLive: "15 seconds",
  });

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const addGraphqlSource = GraphqlClient.mutation("graphql", "addSource");

export const updateGraphqlSource = GraphqlClient.mutation("graphql", "updateSource");

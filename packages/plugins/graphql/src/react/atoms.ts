import { GraphqlClient } from "./client";

// ---------------------------------------------------------------------------
// Mutation atoms
// ---------------------------------------------------------------------------

export const addGraphqlSource = GraphqlClient.mutation("graphql", "addSource");

export const updateGraphqlSource = GraphqlClient.mutation("graphql", "updateSource");

import { Kind, parse, type FragmentDefinitionNode, type SelectionSetNode } from "graphql";
import { sanitizeSegment } from "./tool-path-utils";

/**
 * Parse a GraphQL query string to extract the operation type and root field names.
 * Uses GraphQL AST parsing so aliases/fragments are handled correctly for policy routing.
 */
export function parseGraphqlOperationPaths(
  sourceName: string,
  queryString: string,
): { operationType: "query" | "mutation" | "subscription"; fieldPaths: string[] } {
  const trimmed = queryString.trim();
  if (!trimmed) {
    return { operationType: "query", fieldPaths: [] };
  }

  let operationType: "query" | "mutation" | "subscription" = "query";

  try {
    const document = parse(trimmed, { noLocation: true });
    const firstOperation = document.definitions.find((definition) => definition.kind === Kind.OPERATION_DEFINITION);
    if (!firstOperation || firstOperation.kind !== Kind.OPERATION_DEFINITION) {
      return { operationType, fieldPaths: [] };
    }

    operationType = firstOperation.operation;

    const fragmentByName = new Map<string, FragmentDefinitionNode>(
      document.definitions
        .filter((definition) => definition.kind === Kind.FRAGMENT_DEFINITION)
        .map((definition) => [definition.name.value, definition]),
    );

    const fieldNames = new Set<string>();

    const collectSelectionSet = (
      selectionSet: SelectionSetNode,
      visitedFragments: Set<string>,
    ) => {
      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          const fieldName = selection.name.value;
          if (!fieldName.startsWith("__")) {
            fieldNames.add(fieldName);
          }
          continue;
        }

        if (selection.kind === Kind.INLINE_FRAGMENT) {
          collectSelectionSet(selection.selectionSet, visitedFragments);
          continue;
        }

        if (selection.kind === Kind.FRAGMENT_SPREAD) {
          const fragmentName = selection.name.value;
          if (visitedFragments.has(fragmentName)) continue;
          const fragment = fragmentByName.get(fragmentName);
          if (!fragment) continue;

          const nextVisited = new Set(visitedFragments);
          nextVisited.add(fragmentName);
          collectSelectionSet(fragment.selectionSet, nextVisited);
        }
      }
    };

    collectSelectionSet(firstOperation.selectionSet, new Set());

    return {
      operationType,
      fieldPaths: [...fieldNames]
        .map((fieldName) => `${sanitizeSegment(sourceName)}.${operationType}.${sanitizeSegment(fieldName)}`),
    };
  } catch {
    return { operationType, fieldPaths: [] };
  }
}

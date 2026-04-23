import { useMemo } from "react";
import { useAtomValue, Result } from "@effect-atom/atom-react";

import { useScope } from "@executor/react/api/scope-context";
import {
  SecretBindingPanel,
  type SecretBindingSpec,
} from "@executor/react/plugins/secret-binding-panel";

import { graphqlSourceAtom } from "./atoms";

export default function GraphqlCredentials(props: { sourceId: string }) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(graphqlSourceAtom(scopeId, props.sourceId));

  const source =
    Result.isSuccess(sourceResult) && sourceResult.value ? sourceResult.value : null;

  const specs = useMemo(() => {
    if (!source) return [] as SecretBindingSpec[];

    const out: SecretBindingSpec[] = [];
    const seen = new Set<string>();
    for (const [headerName, value] of Object.entries(source.headers ?? {})) {
      if (typeof value === "string" || seen.has(value.secretId)) continue;
      seen.add(value.secretId);
      out.push({
        secretId: value.secretId,
        label: headerName === "Authorization" ? "API Token" : `${headerName} Header`,
        description: `Used to populate the ${headerName} request header.`,
      });
    }
    return out;
  }, [source]);

  if (!source || specs.length === 0) return null;

  return (
    <SecretBindingPanel
      title="Your Credentials"
      description="Save personal values for this source without changing the shared source configuration."
      sourceName={source.name}
      specs={specs}
    />
  );
}

import { useMemo } from "react";
import { useAtomValue, Result } from "@effect-atom/atom-react";

import { useScope } from "@executor/react/api/scope-context";
import {
  SecretBindingPanel,
  type SecretBindingSpec,
} from "@executor/react/plugins/secret-binding-panel";

import { mcpSourceAtom } from "./atoms";

export default function McpCredentials(props: { sourceId: string }) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(mcpSourceAtom(scopeId, props.sourceId));

  const source =
    Result.isSuccess(sourceResult) && sourceResult.value ? sourceResult.value : null;

  const specs = useMemo(() => {
    if (!source || source.config.transport !== "remote") return [] as SecretBindingSpec[];
    if (source.config.auth.kind !== "header") return [] as SecretBindingSpec[];

    return [
      {
        secretId: source.config.auth.secretId,
        label:
          source.config.auth.headerName === "Authorization"
            ? "API Token"
            : `${source.config.auth.headerName} Header`,
        description: `Used to populate the ${source.config.auth.headerName} request header.`,
      },
    ];
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

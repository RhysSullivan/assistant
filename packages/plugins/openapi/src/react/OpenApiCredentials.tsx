import { useMemo } from "react";
import { useAtomValue, Result } from "@effect-atom/atom-react";

import { useScope } from "@executor/react/api/scope-context";
import {
  SecretBindingPanel,
  type SecretBindingSpec,
} from "@executor/react/plugins/secret-binding-panel";

import { openApiSourceAtom } from "./atoms";

export default function OpenApiCredentials(props: { sourceId: string }) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(openApiSourceAtom(scopeId, props.sourceId));

  const source =
    Result.isSuccess(sourceResult) && sourceResult.value ? sourceResult.value : null;

  const specs = useMemo(() => {
    if (!source) return [] as SecretBindingSpec[];

    const out: SecretBindingSpec[] = [];
    const seen = new Set<string>();
    const push = (spec: SecretBindingSpec) => {
      if (seen.has(spec.secretId)) return;
      seen.add(spec.secretId);
      out.push(spec);
    };

    for (const [headerName, value] of Object.entries(source.config.headers ?? {})) {
      if (typeof value === "string") continue;
      push({
        secretId: value.secretId,
        label: headerName === "Authorization" ? "API Token" : `${headerName} Header`,
        description: `Used to populate the ${headerName} request header.`,
      });
    }

    const oauth2 = source.config.oauth2;
    if (oauth2?.flow === "clientCredentials") {
      push({
        secretId: oauth2.clientIdSecretId,
        label: "Client ID",
        description: "Used when minting a client-credentials access token.",
      });
      if (oauth2.clientSecretSecretId) {
        push({
          secretId: oauth2.clientSecretSecretId,
          label: "Client Secret",
          description: "Used when minting a client-credentials access token.",
        });
      }
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

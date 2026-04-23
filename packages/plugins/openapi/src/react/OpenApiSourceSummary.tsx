import { Result, useAtomValue } from "@effect-atom/atom-react";

import { connectionsAtom, sourceAtom } from "@executor/react/api/atoms";
import { Badge } from "@executor/react/components/badge";
import { useScope } from "@executor/react/api/scope-context";
import { ScopeId } from "@executor/sdk";

import { openApiSourceAtom, openApiSourceBindingsAtom } from "./atoms";

function ConnectedBadge() {
  return (
    <Badge
      variant="outline"
      className="border-green-500/30 bg-green-500/5 text-[10px] text-green-700 dark:text-green-400"
    >
      Connected
    </Badge>
  );
}

function OAuthBadge() {
  return <Badge variant="secondary">OAuth</Badge>;
}

// The entry row already renders name + id + kind, so this summary
// component only contributes extras — specifically, an OAuth status
// badge when the source has OAuth2 configured. Non-OAuth sources
// render nothing.
export default function OpenApiSourceSummary(props: { sourceId: string }) {
  const displayScope = useScope();
  const summaryResult = useAtomValue(sourceAtom(props.sourceId, displayScope));
  const sourceScopeId =
    Result.isSuccess(summaryResult) && summaryResult.value?.scopeId
      ? summaryResult.value.scopeId
      : displayScope;
  const sourceResult = useAtomValue(
    openApiSourceAtom(ScopeId.make(sourceScopeId), props.sourceId),
  );
  const bindingsResult = useAtomValue(
    openApiSourceBindingsAtom(displayScope, props.sourceId, ScopeId.make(sourceScopeId)),
  );
  const connectionsResult = useAtomValue(connectionsAtom(displayScope));

  const oauth2 =
    Result.isSuccess(sourceResult) && sourceResult.value
      ? sourceResult.value.config.oauth2
      : undefined;

  if (!oauth2) return null;
  const bindings = Result.isSuccess(bindingsResult) ? bindingsResult.value : [];
  const connections = Result.isSuccess(connectionsResult) ? connectionsResult.value : [];
  const connectionBinding = bindings.find(
    (binding) =>
      binding.slot === oauth2.connectionSlot &&
      binding.value.kind === "connection",
  );
  const connectionId =
    connectionBinding?.value.kind === "connection"
      ? connectionBinding.value.connectionId
      : null;

  if (
    connectionId &&
    connections.some((connection) => connection.id === connectionId)
  ) {
    return <ConnectedBadge />;
  }

  return <OAuthBadge />;
}

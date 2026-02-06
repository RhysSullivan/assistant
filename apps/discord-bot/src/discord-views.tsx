import { ActionRow, Button, Container, Separator, TextDisplay } from "@openassistant/reacord";
import type { ApprovalDecision } from "@openassistant/core";
import type { ButtonInteraction } from "discord.js";

const ACCENT_ASSISTANT = 0x3b82f6;
const ACCENT_APPROVAL = 0xf59e0b;
const ACCENT_SUCCESS = 0x22c55e;
const ACCENT_DENIED = 0xef4444;
const ACCENT_FOOTER = 0x64748b;

export function AssistantWorkingView() {
  return (
    <Container accentColor={ACCENT_ASSISTANT}>
      <TextDisplay>Working on it...</TextDisplay>
    </Container>
  );
}

export function AssistantReplyView(params: { message: string; footer?: string | undefined }) {
  const paragraphs = splitParagraphs(params.message);

  return (
    <>
      <Container accentColor={ACCENT_ASSISTANT}>
        {paragraphs.length > 0 ? (
          paragraphs.map((paragraph, index) => (
            <TextDisplay key={`paragraph-${index}`}>{paragraph}</TextDisplay>
          ))
        ) : (
          <TextDisplay>Done.</TextDisplay>
        )}
      </Container>
      {params.footer ? (
        <>
          <Separator spacing="small" divider />
          <Container accentColor={ACCENT_FOOTER}>
            <TextDisplay>{params.footer}</TextDisplay>
          </Container>
        </>
      ) : null}
    </>
  );
}

export function ApprovalRequestView(params: {
  toolPath: string;
  callId: string;
  inputPreview?: string | undefined;
  requesterId: string;
  resolved?: { decision: ApprovalDecision; actorId?: string | undefined } | undefined;
  onApprove: (interaction: ButtonInteraction) => void | Promise<void>;
  onDeny: (interaction: ButtonInteraction) => void | Promise<void>;
}) {
  const resolved = params.resolved;
  const decisionText = resolved
    ? resolved.decision === "approved"
      ? `Approved${resolved.actorId ? ` by <@${resolved.actorId}>` : ""}.`
      : `Denied${resolved.actorId ? ` by <@${resolved.actorId}>` : ""}.`
    : null;
  const accent = resolved ? (resolved.decision === "approved" ? ACCENT_SUCCESS : ACCENT_DENIED) : ACCENT_APPROVAL;

  return (
    <Container accentColor={accent}>
      <TextDisplay>Approval requested for `{params.toolPath}`.</TextDisplay>
      {params.inputPreview ? <TextDisplay>Input: `{params.inputPreview}`</TextDisplay> : null}
      <TextDisplay>{`Requested by <@${params.requesterId}>.`}</TextDisplay>
      {decisionText ? <TextDisplay>{decisionText}</TextDisplay> : null}
      {!resolved ? (
        <ActionRow>
          <Button style="success" label="Approve" onClick={params.onApprove} />
          <Button style="danger" label="Deny" onClick={params.onDeny} />
        </ActionRow>
      ) : null}
      <TextDisplay>Call: `{params.callId}`</TextDisplay>
    </Container>
  );
}

function splitParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

import type { ApprovalDecision, ApprovalRequest } from "@openassistant/core";
import { type ReacordInstance, makeReacord } from "@openassistant/reacord";
import type { ButtonInteraction, Client, SendableChannels } from "discord.js";
import { Effect } from "effect";
import { ApprovalRegistry } from "./approval-registry.js";
import { ApprovalRequestView } from "./discord-views.js";

type ReacordApi = ReturnType<typeof makeReacord>;

export class DiscordApprovalBridge {
  private readonly registry: ApprovalRegistry;
  private readonly reacord: ReacordApi;

  constructor(client: Client, timeoutMs: number = 5 * 60_000) {
    this.registry = new ApprovalRegistry(timeoutMs);
    this.reacord = makeReacord(client);
  }

  async requestApproval(params: {
    request: ApprovalRequest;
    channel: SendableChannels;
    requesterId: string;
  }): Promise<ApprovalDecision> {
    const { request, channel, requesterId } = params;
    const pending = this.registry.open(request.callId, requesterId);
    let instance: ReacordInstance | null = null;
    let resolvedActorId: string | undefined;

    try {
      const handleDecision = async (interaction: ButtonInteraction, decision: ApprovalDecision): Promise<void> => {
        const status = this.registry.resolve(request.callId, interaction.user.id, decision);
        if (status === "unauthorized") {
          await interaction.reply({
            content: "Only the requesting user can resolve this approval.",
            ephemeral: true,
          });
          return;
        }

        if (status === "not_found") {
          await interaction.reply({
            content: "This approval is no longer pending.",
            ephemeral: true,
          });
          return;
        }

        resolvedActorId = interaction.user.id;
        instance?.render(
          <ApprovalRequestView
            toolPath={request.toolPath}
            callId={request.callId}
            inputPreview={request.inputPreview}
            requesterId={requesterId}
            resolved={{ decision, actorId: interaction.user.id }}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />,
        );
      };
      const handleApprove = (interaction: ButtonInteraction) => handleDecision(interaction, "approved");
      const handleDeny = (interaction: ButtonInteraction) => handleDecision(interaction, "denied");

      instance = await Effect.runPromise(
        this.reacord.send(
          channel,
          <ApprovalRequestView
            toolPath={request.toolPath}
            callId={request.callId}
            inputPreview={request.inputPreview}
            requesterId={requesterId}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />,
        ),
      );
    } catch {
      this.registry.cancel(request.callId, "denied");
    }

    const decision = await pending;

    if (instance) {
      instance.render(
        <ApprovalRequestView
          toolPath={request.toolPath}
          callId={request.callId}
          inputPreview={request.inputPreview}
          requesterId={requesterId}
          resolved={{ decision, actorId: resolvedActorId }}
          onApprove={() => {}}
          onDeny={() => {}}
        />,
      );
      instance.deactivate();
    }

    return decision;
  }
}

import {
  HttpApiBuilder,
  HttpServerResponse,
} from "@effect/platform";
import type {
  ExecutionInteraction,
  Source,
  WorkspaceId,
} from "#schema";
import * as Effect from "effect/Effect";

import { requirePermission, withPolicy } from "#domain";
import {
  createSource,
  getSource,
  listSources,
  removeSource,
  updateSource,
} from "../../runtime/sources-operations";
import {
  completeSourceCredentialSetup,
  getSourceCredentialInteraction,
  submitSourceCredentialInteraction,
} from "../../runtime/local-operations";

import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "../errors";
import { ControlPlaneApi } from "../api";
import { withWorkspaceRequestActor } from "../http-auth";

const requireReadSources = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "sources:read",
    workspaceId,
  });

const requireWriteSources = (workspaceId: WorkspaceId) =>
  requirePermission({
    permission: "sources:write",
    workspaceId,
  });

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const credentialPageDocument = (input: {
  title: string;
  eyebrow: string;
  message: string;
  sourceLabel: string;
  endpoint: string;
  interactionId: string;
  error?: string;
  state?: "pending" | "stored" | "continued" | "cancelled" | "inactive";
}) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg: #fafaf9;
        --surface: #ffffff;
        --text: #1c1917;
        --text-secondary: #78716c;
        --text-tertiary: #a8a29e;
        --border: #e7e5e4;
        --accent: #1d4ed8;
        --accent-light: #eff6ff;
        --green: #16a34a;
        --green-light: #f0fdf4;
        --green-border: #bbf7d0;
        --red: #dc2626;
        --red-light: #fef2f2;
        --red-border: #fecaca;
        --amber: #d97706;
        --amber-light: #fffbeb;
        --amber-border: #fde68a;
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
        display: flex;
        justify-content: center;
        padding: 80px 24px 48px;
        -webkit-font-smoothing: antialiased;
      }

      .page {
        width: 100%;
        max-width: 540px;
      }

      /* Status pill at the very top */
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 5px 14px 5px 10px;
        border-radius: 999px;
        font-family: 'DM Mono', monospace;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.01em;
        margin-bottom: 28px;
      }

      .status-pill::before {
        content: '';
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-pill[data-state='pending'] {
        background: var(--amber-light);
        color: var(--amber);
        border: 1px solid var(--amber-border);
      }
      .status-pill[data-state='pending']::before { background: var(--amber); }

      .status-pill[data-state='stored'] {
        background: var(--green-light);
        color: var(--green);
        border: 1px solid var(--green-border);
      }
      .status-pill[data-state='stored']::before { background: var(--green); }

      .status-pill[data-state='continued'] {
        background: var(--green-light);
        color: var(--green);
        border: 1px solid var(--green-border);
      }
      .status-pill[data-state='continued']::before { background: var(--green); }

      .status-pill[data-state='cancelled'],
      .status-pill[data-state='inactive'] {
        background: #f5f5f4;
        color: var(--text-secondary);
        border: 1px solid var(--border);
      }
      .status-pill[data-state='cancelled']::before,
      .status-pill[data-state='inactive']::before { background: var(--text-tertiary); }

      /* Title area */
      h1 {
        font-size: 28px;
        font-weight: 600;
        letter-spacing: -0.025em;
        line-height: 1.2;
        margin-bottom: 10px;
      }

      .subtitle {
        font-size: 15px;
        line-height: 1.6;
        color: var(--text-secondary);
      }

      /* Divider */
      hr {
        border: none;
        height: 1px;
        background: var(--border);
        margin: 36px 0;
      }

      /* Source detail rows */
      .detail {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 24px;
      }

      .detail-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
      }

      .detail-value {
        font-size: 15px;
        line-height: 1.5;
        word-break: break-word;
      }

      .detail-mono {
        font-family: 'DM Mono', monospace;
        font-size: 13px;
        line-height: 1.5;
        padding: 10px 14px;
        background: #f5f5f4;
        border: 1px solid var(--border);
        border-radius: 8px;
        word-break: break-all;
        color: var(--text);
      }

      .detail-id {
        font-family: 'DM Mono', monospace;
        font-size: 12px;
        color: var(--text-tertiary);
      }

      /* Result card for stored/cancelled/inactive */
      .result-card {
        padding: 32px;
        border-radius: 12px;
        text-align: center;
      }

      .result-card.success {
        background: var(--green-light);
        border: 1px solid var(--green-border);
      }

      .result-card.neutral {
        background: #f5f5f4;
        border: 1px solid var(--border);
      }

      .result-card p {
        font-size: 15px;
        line-height: 1.6;
        color: var(--text-secondary);
      }

      .result-card .result-heading {
        font-weight: 600;
        font-size: 15px;
        color: var(--text);
        margin-bottom: 6px;
      }

      /* Form */
      .alert {
        padding: 12px 14px;
        border-radius: 8px;
        background: var(--red-light);
        border: 1px solid var(--red-border);
        color: var(--red);
        font-size: 14px;
        line-height: 1.5;
        margin-bottom: 20px;
      }

      .field { margin-bottom: 20px; }

      label {
        display: block;
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 6px;
      }

      input[type='password'] {
        width: 100%;
        padding: 10px 14px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 8px;
        font-family: 'DM Mono', monospace;
        font-size: 14px;
        color: var(--text);
        transition: border-color 0.15s, box-shadow 0.15s;
      }

      input[type='password']::placeholder { color: var(--text-tertiary); }

      input[type='password']:focus {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(29, 78, 216, 0.1);
      }

      .hint {
        margin-top: 8px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-tertiary);
      }

      .actions {
        display: flex;
        gap: 10px;
        margin-top: 24px;
      }

      button {
        appearance: none;
        border: none;
        border-radius: 8px;
        padding: 10px 20px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
      }

      .primary {
        background: var(--text);
        color: var(--surface);
      }
      .primary:hover { background: #292524; }

      .secondary {
        background: transparent;
        color: var(--text-secondary);
        border: 1px solid var(--border);
      }
      .secondary:hover { background: #f5f5f4; }

      @media (max-width: 540px) {
        body { padding: 48px 20px 32px; }
        h1 { font-size: 24px; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="status-pill" data-state="${escapeHtml(input.state ?? "pending")}">${escapeHtml(input.state ?? "pending")}</div>

      <h1>${escapeHtml(input.title)}</h1>
      <p class="subtitle">${escapeHtml(input.message)}</p>

      <hr />

      <div class="detail">
        <span class="detail-label">Source</span>
        <span class="detail-value">${escapeHtml(input.sourceLabel)}</span>
      </div>

      <div class="detail">
        <span class="detail-label">API endpoint</span>
        <div class="detail-mono">${escapeHtml(input.endpoint)}</div>
      </div>

      <div class="detail">
        <span class="detail-label">Interaction</span>
        <span class="detail-id">${escapeHtml(input.interactionId)}</span>
      </div>

      <hr />

      ${
        input.error
          ? `<p class="alert">${escapeHtml(input.error)}</p>`
          : ""
      }
      ${
        input.state === "stored"
          ? `<div class="result-card success">
              <p class="result-heading">Credential stored</p>
              <p>Executor resumed the source connection request. You can close this window.</p>
            </div>`
          : input.state === "continued"
            ? `<div class="result-card success">
                <p class="result-heading">Continuing without auth</p>
                <p>Executor resumed the source connection without stored credentials. You can close this window.</p>
              </div>`
          : input.state === "cancelled"
            ? `<div class="result-card neutral">
                <p class="result-heading">Request cancelled</p>
                <p>Executor was notified. You can close this window.</p>
              </div>`
            : input.state === "inactive"
              ? `<div class="result-card neutral">
                  <p class="result-heading">No longer active</p>
                  <p>This credential request has expired. Start a new source connection flow if needed.</p>
                </div>`
              : `<form method="post">
            <div class="field">
              <label for="token">Personal access token</label>
              <input
                id="token"
                name="token"
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder="ghp_..."
              />
              <p class="hint">
                Add a token to enable authenticated requests, or continue without auth if this API supports public access.
              </p>
            </div>
            <div class="actions">
              <button class="primary" type="submit" name="action" value="submit">Connect token</button>
              <button class="secondary" type="submit" name="action" value="continue" formnovalidate>Continue without auth</button>
              <button class="secondary" type="submit" name="action" value="cancel" formnovalidate>Cancel</button>
            </div>
          </form>`
      }
    </main>
  </body>
</html>`;

const htmlResponse = (html: string, status = 200) =>
  HttpServerResponse.html(html).pipe(
    HttpServerResponse.setStatus(status),
  );

const credentialErrorResponse = (input: {
  title: string;
  message: string;
  status: number;
}) =>
  htmlResponse(
    credentialPageDocument({
      title: input.title,
      eyebrow: "Executor",
      message: input.message,
      sourceLabel: "Unavailable",
      endpoint: "Unavailable",
      interactionId: "unavailable",
      state: "inactive",
      error: input.message,
    }),
    input.status,
  );

const credentialErrorStatus = (
  error: ControlPlaneBadRequestError | ControlPlaneNotFoundError | ControlPlaneStorageError,
) =>
  error instanceof ControlPlaneNotFoundError
    ? 404
    : error instanceof ControlPlaneBadRequestError
      ? 400
      : 500;

const credentialSubmitErrorResponse = (input: {
  workspaceId: WorkspaceId;
  sourceId: Source["id"];
  interactionId: ExecutionInteraction["id"];
  message: string;
  status: number;
}) =>
  getSourceCredentialInteraction({
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    interactionId: input.interactionId,
  }).pipe(
    Effect.match({
      onFailure: () =>
        credentialErrorResponse({
          title: "Source Credential Request Failed",
          message: input.message,
          status: input.status,
        }),
      onSuccess: (interaction) =>
        htmlResponse(
          credentialPageDocument({
            title: "Configure Source Access",
            eyebrow: "Executor",
            message: interaction.message,
            sourceLabel: interaction.sourceLabel,
            endpoint: interaction.endpoint,
            interactionId: interaction.interactionId,
            error: input.message,
            state: "pending",
          }),
          input.status,
        ),
    }),
  );

export const ControlPlaneSourcesLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "sources",
  (handlers) =>
    handlers
      .handle("list", ({ path }) =>
        withWorkspaceRequestActor("sources.list", path.workspaceId, () =>
          withPolicy(requireReadSources(path.workspaceId))(
            listSources(path.workspaceId),
          ),
        ),
      )
      .handle("create", ({ path, payload }) =>
        withWorkspaceRequestActor("sources.create", path.workspaceId, () =>
          withPolicy(requireWriteSources(path.workspaceId))(
            createSource({ workspaceId: path.workspaceId, payload }),
          ),
        ),
      )
      .handle("get", ({ path }) =>
        withWorkspaceRequestActor("sources.get", path.workspaceId, () =>
          withPolicy(requireReadSources(path.workspaceId))(
            getSource({
              workspaceId: path.workspaceId,
              sourceId: path.sourceId,
            }),
          ),
        ),
      )
      .handle("update", ({ path, payload }) =>
        withWorkspaceRequestActor("sources.update", path.workspaceId, () =>
          withPolicy(requireWriteSources(path.workspaceId))(
            updateSource({
              workspaceId: path.workspaceId,
              sourceId: path.sourceId,
              payload,
            }),
          ),
        ),
      )
      .handle("remove", ({ path }) =>
        withWorkspaceRequestActor("sources.remove", path.workspaceId, () =>
          withPolicy(requireWriteSources(path.workspaceId))(
            removeSource({
              workspaceId: path.workspaceId,
              sourceId: path.sourceId,
            }),
          ),
        ),
      )
      .handle("credentialPage", ({ path, urlParams }) =>
        getSourceCredentialInteraction({
          workspaceId: path.workspaceId,
          sourceId: path.sourceId,
          interactionId: urlParams.interactionId,
        }).pipe(
          Effect.map((interaction) =>
            htmlResponse(
              credentialPageDocument({
                title: "Configure Source Access",
                eyebrow: "Executor",
                message: interaction.message,
                sourceLabel: interaction.sourceLabel,
                endpoint: interaction.endpoint,
                interactionId: interaction.interactionId,
                state: interaction.status === "pending" ? "pending" : "inactive",
              }),
            )
          ),
          Effect.catchTags({
            ControlPlaneNotFoundError: (error) =>
              Effect.succeed(
                credentialErrorResponse({
                  title: "Source Credential Request Unavailable",
                  message: error.message,
                  status: credentialErrorStatus(error),
                }),
              ),
            ControlPlaneStorageError: (error) =>
              Effect.succeed(
                credentialErrorResponse({
                  title: "Source Credential Request Failed",
                  message: error.message,
                  status: credentialErrorStatus(error),
                }),
              ),
          }),
        ),
      )
      .handle("credentialSubmit", ({ path, urlParams, payload }) =>
        submitSourceCredentialInteraction({
          workspaceId: path.workspaceId,
          sourceId: path.sourceId,
          interactionId: urlParams.interactionId,
          action:
            payload.action === "cancel"
              ? "cancel"
              : payload.action === "continue"
                ? "continue"
                : "submit",
          token: payload.token,
        }).pipe(
          Effect.map((result) =>
            htmlResponse(
              credentialPageDocument({
                title:
                  result.kind === "stored"
                    ? "Source Credential Stored"
                    : result.kind === "continued"
                      ? "Source Access Updated"
                    : "Source Credential Request Cancelled",
                eyebrow: "Executor",
                message:
                  result.kind === "stored"
                    ? "Executor stored the credential and resumed the source connection."
                    : result.kind === "continued"
                      ? "Executor resumed the source connection without stored credentials."
                    : "Executor cancelled the source credential request.",
                sourceLabel: result.sourceLabel,
                endpoint: result.endpoint,
                interactionId: urlParams.interactionId,
                state:
                  result.kind === "stored"
                    ? "stored"
                    : result.kind === "continued"
                      ? "continued"
                      : "cancelled",
              }),
            )
          ),
          Effect.catchTags({
            ControlPlaneBadRequestError: (error) =>
              credentialSubmitErrorResponse({
                workspaceId: path.workspaceId,
                sourceId: path.sourceId,
                interactionId: urlParams.interactionId,
                message: error.message,
                status: credentialErrorStatus(error),
              }),
            ControlPlaneNotFoundError: (error) =>
              Effect.succeed(
                credentialErrorResponse({
                  title: "Source Credential Request Unavailable",
                  message: error.message,
                  status: credentialErrorStatus(error),
                }),
              ),
            ControlPlaneStorageError: (error) =>
              Effect.succeed(
                credentialErrorResponse({
                  title: "Source Credential Request Failed",
                  message: error.message,
                  status: credentialErrorStatus(error),
                }),
              ),
          }),
        ),
      )
      .handle("credentialComplete", ({ path, urlParams }) =>
        completeSourceCredentialSetup({
          workspaceId: path.workspaceId,
          sourceId: path.sourceId,
          state: urlParams.state,
          code: urlParams.code,
          error: urlParams.error,
          errorDescription: urlParams.error_description,
        }).pipe(
          Effect.map((source) => `Source connected: ${source.id}. You can close this window.`),
        ),
      ),
);

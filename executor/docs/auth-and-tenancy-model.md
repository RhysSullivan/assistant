# Auth-Agnostic Identity and Workspace Model (Draft)

This document defines the target identity, session, workspace, and policy model for executor.

Goals:

- Support many workspaces per login identity.
- Support many login identities per human (corporate + personal + consulting accounts).
- Support simultaneous sessions for multiple identities in one browser/device.
- Support anonymous usage with UUID identities.
- Keep authentication provider-agnostic (WorkOS, Better Auth, custom OIDC, etc.).
- Keep authorization and approval policy in executor domain, independent of auth provider.

## Principles

1. `email` is an attribute, not a primary identity key.
2. `auth_identity` is provider-specific; `actor` is provider-neutral principal.
3. `workspace` is the permission boundary.
4. AuthN and AuthZ are separate concerns.
5. Anonymous identity is first-class.

## Core Entities

### actor

Canonical principal in executor.

- `id`
- `display_name`
- `kind` (`human`, `service`)
- `created_at`, `updated_at`

### auth_identity

Provider identity mapped to an actor.

- `id`
- `actor_id` -> `actor.id`
- `provider` (e.g. `workos`, `better-auth`, `oidc`, `anonymous`, `email-link`)
- `provider_subject` (stable provider user ID)
- `email` (nullable)
- `email_verified` (nullable)
- `metadata_json`
- `created_at`, `updated_at`

Unique constraint:

- `(provider, provider_subject)`

### session

Application session bound to one auth identity (and therefore one actor).

- `id`
- `actor_id`
- `auth_identity_id`
- `token_hash`
- `device_label`
- `ip_address`
- `user_agent`
- `expires_at`
- `revoked_at`
- `created_at`, `last_seen_at`

Multiple concurrent sessions are allowed per actor and per device.

### workspace

Tenant boundary for data and policy.

- `id`
- `slug`
- `name`
- `plan` (`free`, `pro`, `enterprise`)
- `created_by_actor_id`
- `created_at`, `updated_at`

### workspace_membership

Actor access to workspace.

- `id`
- `workspace_id`
- `actor_id`
- `role` (`owner`, `admin`, `member`, `viewer`, `billing`)
- `status` (`active`, `invited`, `suspended`)
- `invited_by_actor_id`
- `created_at`, `updated_at`

Unique constraint:

- `(workspace_id, actor_id)`

### workspace_auth_policy

Workspace-level auth restrictions.

- `workspace_id`
- `require_sso` (bool)
- `allowed_email_domains_json`
- `allow_anonymous` (bool)
- `session_ttl_hours`
- `created_at`, `updated_at`

## Tool Governance and Policy

### tool_source

Workspace-shared MCP/OpenAPI/custom source config.

- `id`
- `workspace_id`
- `name`
- `type` (`mcp`, `openapi`, `custom`)
- `config_json`
- `enabled`
- `version`
- `created_by_actor_id`
- `created_at`, `updated_at`

### tool_catalog_entry

Discovered/generated callable tool under a source.

- `id`
- `workspace_id`
- `tool_source_id`
- `tool_path`
- `description`
- `args_type`
- `returns_type`
- `default_approval` (`auto`, `required`, `deny`)
- `enabled`
- `created_at`, `updated_at`

### client

A consumer of executor inside a workspace (agent, server integration, app instance).

- `id`
- `workspace_id`
- `name`
- `kind` (`assistant`, `api`, `webhook`, `other`)
- `created_at`, `updated_at`

### policy_rule

Layered authorization for tool invocation and approval behavior.

- `id`
- `workspace_id`
- `scope` (`workspace`, `team`, `actor`, `client`, `actor_client`)
- `actor_id` (nullable)
- `client_id` (nullable)
- `tool_path_pattern`
- `decision` (`allow`, `require_approval`, `deny`)
- `conditions_json`
- `priority` (integer)
- `created_by_actor_id`
- `created_at`, `updated_at`

Recommended precedence:

1. `actor_client`
2. `actor`
3. `client`
4. `team`
5. `workspace`
6. system default

## Runtime/Task Attribution Updates

Current task/approval tables should gain tenant/principal context:

- `tasks.workspace_id`
- `tasks.client_id` (nullable)
- `tasks.actor_id` (requesting principal)
- `approvals.workspace_id`
- `approvals.client_id` (nullable)
- `approvals.requested_by_actor_id`
- `approvals.resolved_by_actor_id`

All task and approval queries should be workspace-scoped.

## Auth Provider Adapter Boundary

Executor should expose a provider-neutral auth adapter:

- resolve incoming credentials/token to `auth_identity`
- provision/link `actor`
- issue/revoke executor `session`
- sync provider metadata and deprovisioning events

Provider examples:

- WorkOS adapter
- Better Auth adapter
- Generic OIDC adapter
- Anonymous adapter

## Anonymous Identity Model

Anonymous flow:

1. create `actor(kind=human)`
2. create `auth_identity(provider=anonymous, provider_subject=<uuid>)`
3. issue `session`

Upgrade flow:

- Link a non-anonymous `auth_identity` to same actor.
- Optionally block anonymous identities in enterprise workspaces via `workspace_auth_policy`.

## Suggested Rollout (Thin Slices)

1. Introduce `actor`, `auth_identity`, `session`, `workspace`, `workspace_membership`.
2. Add workspace scoping to tasks/approvals and APIs.
3. Add `tool_source` and workspace-shared source configuration.
4. Add `client` and `policy_rule` evaluation.
5. Add provider adapters and webhooks (WorkOS/Better Auth/etc.).

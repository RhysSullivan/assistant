import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import {
  CreateSecretPayloadSchema,
  CreateSecretResultSchema,
  DeleteSecretResultSchema,
  InstanceConfigSchema,
  SecretListItemSchema,
  UpdateSecretPayloadSchema,
  UpdateSecretResultSchema,
} from "@executor/platform-sdk/contracts";
import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "@executor/platform-sdk/errors";
import { LocalInstallationSchema } from "@executor/platform-sdk/schema";
import * as Schema from "effect/Schema";

export type {
  CreateSecretPayload,
  CreateSecretResult,
  DeleteSecretResult,
  InstanceConfig,
  SecretLinkedSource,
  SecretListItem,
  SecretProvider,
  UpdateSecretPayload,
  UpdateSecretResult,
} from "@executor/platform-sdk/contracts";

export class LocalApi extends HttpApiGroup.make("local")
  .add(
    HttpApiEndpoint.get("installation")`/local/installation`
      .addSuccess(LocalInstallationSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get("config")`/local/config`
      .addSuccess(InstanceConfigSchema)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.get("listSecrets")`/local/secrets`
      .addSuccess(Schema.Array(SecretListItemSchema))
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.post("createSecret")`/local/secrets`
      .setPayload(CreateSecretPayloadSchema)
      .addSuccess(CreateSecretResultSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.patch("updateSecret")`/local/secrets/${HttpApiSchema.param("secretId", Schema.String)}`
      .setPayload(UpdateSecretPayloadSchema)
      .addSuccess(UpdateSecretResultSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .add(
    HttpApiEndpoint.del("deleteSecret")`/local/secrets/${HttpApiSchema.param("secretId", Schema.String)}`
      .addSuccess(DeleteSecretResultSchema)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .prefix("/v1") {}

import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { LocalInstallationSchema } from "#schema";

import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "../errors";

export class LocalApi extends HttpApiGroup.make("local")
  .add(
    HttpApiEndpoint.get("installation")`/local/installation`
      .addSuccess(LocalInstallationSchema)
      .addError(ControlPlaneBadRequestError)
      .addError(ControlPlaneNotFoundError)
      .addError(ControlPlaneStorageError),
  )
  .prefix("/v1") {}

import { HttpApi, OpenApi } from "@effect/platform";

import { SourcesApi } from "./sources/api";

export {
  ControlPlaneBadRequestError,
  ControlPlaneStorageError,
} from "./errors";

export {
  RemoveSourceResultSchema,
  UpsertSourcePayloadSchema,
  type RemoveSourceResult,
  type UpsertSourcePayload,
} from "./sources/api";

export class ControlPlaneApi extends HttpApi.make("controlPlane")
  .add(SourcesApi)
  .annotateContext(
    OpenApi.annotations({
      title: "Executor v2 Control Plane API",
      description: "Backend-agnostic control plane API",
    }),
  ) {}

export const controlPlaneOpenApiSpec = OpenApi.fromApi(ControlPlaneApi);

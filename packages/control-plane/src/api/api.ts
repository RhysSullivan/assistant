import { HttpApi, OpenApi } from "@effect/platform";

import { ExecutionsApi } from "./executions/api";
import { LocalApi } from "./local/api";
import { OAuthApi } from "./oauth/api";
import { PoliciesApi } from "./policies/api";
import { SourcesApi } from "./sources/api";

export class ControlPlaneApi extends HttpApi.make("controlPlane")
  .add(LocalApi)
  .add(OAuthApi)
  .add(SourcesApi)
  .add(PoliciesApi)
  .add(ExecutionsApi)
  .annotateContext(
    OpenApi.annotations({
      title: "Executor Control Plane API",
      description: "Local-first control plane for workspace sources, policies, auth, and execution",
    }),
  ) {}

export const controlPlaneOpenApiSpec = OpenApi.fromApi(ControlPlaneApi);

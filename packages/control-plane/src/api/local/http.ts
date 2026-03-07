import {
  HttpApiBuilder,
} from "@effect/platform";

import {
  getLocalInstallation,
} from "../../runtime/local-operations";

import { ControlPlaneApi } from "../api";

export const ControlPlaneLocalLive = HttpApiBuilder.group(
  ControlPlaneApi,
  "local",
  (handlers) =>
    handlers
      .handle("installation", () =>
        getLocalInstallation(),
      ),
);

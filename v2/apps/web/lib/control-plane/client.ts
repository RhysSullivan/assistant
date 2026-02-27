import { createControlPlaneAtomClient } from "@executor-v2/control-plane";

export const controlPlaneClient = createControlPlaneAtomClient({
  baseUrl: process.env.NEXT_PUBLIC_CONTROL_PLANE_BASE_URL ?? "/api/control-plane",
});

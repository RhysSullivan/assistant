import { AuthKit, type AuthFunctions } from "@convex-dev/workos-authkit";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel.d.ts";
import { workosEventHandlers } from "./event_handlers";

export const workosEnabled = Boolean(
  process.env.WORKOS_CLIENT_ID && process.env.WORKOS_API_KEY && process.env.WORKOS_WEBHOOK_SECRET,
);

const authFunctions = (internal as Record<string, unknown>).auth as AuthFunctions;
const workosComponent = (components as Record<string, unknown>).workOSAuthKit;

const authKitInstance = workosEnabled
  ? new AuthKit<DataModel>(workosComponent as never, {
      authFunctions,
      additionalEventTypes: [
        "organization.created",
        "organization.updated",
        "organization.deleted",
        "organization_membership.created",
        "organization_membership.updated",
        "organization_membership.deleted",
      ],
    })
  : null;

export const authKit =
  authKitInstance ??
  ({
    registerRoutes: () => {},
  } as Pick<AuthKit<DataModel>, "registerRoutes">);

export const authKitEvents = workosEnabled && authKitInstance
  ? authKitInstance.events(workosEventHandlers)
  : null;

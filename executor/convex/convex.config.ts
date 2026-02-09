import actionCache from "@convex-dev/action-cache/convex.config.js";
import stripe from "@convex-dev/stripe/convex.config.js";
import workOSAuthKit from "@convex-dev/workos-authkit/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();

app.use(workOSAuthKit);
app.use(stripe);
// TODO: Remove actionCache component after confirming no deployments depend on it.
// All OpenAPI spec caching now uses Convex file storage (openApiSpecCache / workspaceToolCache tables).
app.use(actionCache);

export default app;

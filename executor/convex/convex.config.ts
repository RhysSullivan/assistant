import workOSAuthKit from "@convex-dev/workos-authkit/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();

app.use(workOSAuthKit);

export default app;

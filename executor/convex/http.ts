import { httpRouter } from "convex/server";
import { authKit } from "./auth";

const http = httpRouter();

authKit.registerRoutes(http);

export default http;

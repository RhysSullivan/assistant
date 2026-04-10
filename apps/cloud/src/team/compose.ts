import { HttpApi } from "@effect/platform";
import { OrgAuth } from "../auth/middleware";
import { TeamApi } from "./api";

/** Team API with org-level auth — requires authenticated session with an org. */
export const TeamOrgApi = HttpApi.make("teamOrg").add(TeamApi).middleware(OrgAuth);

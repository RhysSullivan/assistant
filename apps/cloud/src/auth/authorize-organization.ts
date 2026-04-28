import { Effect } from "effect";

import { IdentityDirectory } from "../identity/directory";

export const authorizeOrganization = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const directory = yield* IdentityDirectory;
    return yield* directory.authorizeOrganization(userId, organizationId);
  });

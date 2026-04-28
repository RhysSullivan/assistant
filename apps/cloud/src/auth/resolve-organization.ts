import { Effect } from "effect";

import { IdentityDirectory } from "../identity/directory";

export const resolveOrganization = (organizationId: string) =>
  Effect.gen(function* () {
    const directory = yield* IdentityDirectory;
    return yield* directory.getOrganization(organizationId);
  });

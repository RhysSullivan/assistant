import { createStorageContractSuite, storageContractSchema } from "@executor/storage/test-suite";

import { makeInMemorySqliteStorage } from "./index";

createStorageContractSuite("sqlite in-memory", {
  schema: storageContractSchema,
  makeStorage: () => makeInMemorySqliteStorage({ schema: storageContractSchema }),
});

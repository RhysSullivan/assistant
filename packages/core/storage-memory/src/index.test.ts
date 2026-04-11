import { createStorageContractSuite, storageContractSchema } from "@executor/storage/test-suite";

import { makeMemoryStorage } from "./index";

createStorageContractSuite("memory", {
  schema: storageContractSchema,
  makeStorage: () => makeMemoryStorage({ schema: storageContractSchema }),
});

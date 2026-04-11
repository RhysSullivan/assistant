import { createStorageContractSuite, storageContractSchema } from "@executor/storage/test-suite";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { makePostgresStorage } from "./executor-storage";

createStorageContractSuite("postgres", {
  schema: storageContractSchema,
  makeStorage: () =>
    makePostgresStorage(drizzle(new PGlite()), {
      schema: storageContractSchema,
    }),
});

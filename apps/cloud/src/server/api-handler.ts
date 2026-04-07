import { createCloudApiHandler } from "../api";
import { getDb } from "../services/db";

const handlerPromise = getDb().then((db) =>
  createCloudApiHandler(db, process.env.ENCRYPTION_KEY ?? "local-dev-encryption-key"),
);

export const handleApiRequest = async (request: Request) =>
  (await handlerPromise)(request);

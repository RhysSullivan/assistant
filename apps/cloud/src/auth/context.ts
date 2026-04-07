import { Context, Effect, Layer, Schema } from "effect";
import { makeUserStore } from "@executor/storage-postgres";
import type { DrizzleDb } from "../services/db";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UserStoreError extends Schema.TaggedError<UserStoreError>()(
  "UserStoreError",
  { cause: Schema.Unknown },
) {}

export class WorkOSError extends Schema.TaggedError<WorkOSError>()(
  "WorkOSError",
  { cause: Schema.Unknown },
) {}

// ---------------------------------------------------------------------------
// AuthContext — resolved per-request from sealed session
// ---------------------------------------------------------------------------

export class AuthContext extends Context.Tag("@executor/cloud/AuthContext")<
  AuthContext,
  {
    readonly userId: string;
    readonly teamId: string;
    readonly email: string;
    readonly name: string | null;
    readonly avatarUrl: string | null;
  }
>() {}

// ---------------------------------------------------------------------------
// UserStoreService — wraps the Drizzle-backed user store with Effect
// ---------------------------------------------------------------------------

type RawStore = ReturnType<typeof makeUserStore>;

const makeService = (db: DrizzleDb) => {
  const store = makeUserStore(db);

  const use = <A>(fn: (s: RawStore) => Promise<A>) =>
    Effect.tryPromise({
      try: () => fn(store),
      catch: (cause) => new UserStoreError({ cause }),
    }).pipe(Effect.withSpan("user_store"));

  return { use };
};

type UserStoreServiceType = ReturnType<typeof makeService>;

export class UserStoreService extends Context.Tag("@executor/cloud/UserStoreService")<
  UserStoreService,
  UserStoreServiceType
>() {
  static layer = (db: DrizzleDb) =>
    Layer.succeed(this, makeService(db));
}

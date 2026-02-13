import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

export const getActiveAnonymousOauthSigningKey = internalQuery({
  args: {},
  handler: async (ctx) => {
    const doc = await ctx.db
      .query("anonymousOauthSigningKeys")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .first();

    if (!doc) {
      return null;
    }

    return {
      keyId: doc.keyId,
      algorithm: doc.algorithm,
      privateKeyJwk: doc.privateKeyJwk,
      publicKeyJwk: doc.publicKeyJwk,
      createdAt: doc.createdAt,
    };
  },
});

export const storeAnonymousOauthSigningKey = internalMutation({
  args: {
    keyId: v.string(),
    algorithm: v.string(),
    privateKeyJwk: v.any(),
    publicKeyJwk: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const activeKeys = await ctx.db
      .query("anonymousOauthSigningKeys")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    for (const key of activeKeys) {
      await ctx.db.patch(key._id, { status: "rotated", rotatedAt: now });
    }

    await ctx.db.insert("anonymousOauthSigningKeys", {
      keyId: args.keyId,
      algorithm: args.algorithm,
      privateKeyJwk: args.privateKeyJwk,
      publicKeyJwk: args.publicKeyJwk,
      status: "active",
      createdAt: now,
    });
  },
});

export const registerAnonymousOauthClient = internalMutation({
  args: {
    clientId: v.string(),
    clientName: v.optional(v.string()),
    redirectUris: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("anonymousOauthClients", {
      clientId: args.clientId,
      clientName: args.clientName,
      redirectUris: args.redirectUris,
      createdAt: now,
    });

    return {
      client_id: args.clientId,
      client_name: args.clientName,
      redirect_uris: args.redirectUris,
      created_at: now,
    };
  },
});

export const getAnonymousOauthClient = internalQuery({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("anonymousOauthClients")
      .withIndex("by_client_id", (q) => q.eq("clientId", args.clientId))
      .unique();

    if (!doc) {
      return null;
    }

    return {
      client_id: doc.clientId,
      client_name: doc.clientName,
      redirect_uris: doc.redirectUris,
      created_at: doc.createdAt,
    };
  },
});

export const storeAnonymousOauthAuthorizationCode = internalMutation({
  args: {
    code: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    codeChallengeMethod: v.string(),
    actorId: v.string(),
    tokenClaims: v.optional(v.any()),
    expiresAt: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("anonymousOauthCodes", {
      code: args.code,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      codeChallenge: args.codeChallenge,
      codeChallengeMethod: args.codeChallengeMethod,
      actorId: args.actorId,
      tokenClaims: args.tokenClaims,
      expiresAt: args.expiresAt,
      createdAt: args.createdAt,
    });
  },
});

export const consumeAnonymousOauthAuthorizationCode = internalMutation({
  args: {
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("anonymousOauthCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();

    if (!doc) {
      return null;
    }

    await ctx.db.delete(doc._id);

    return {
      code: doc.code,
      clientId: doc.clientId,
      redirectUri: doc.redirectUri,
      codeChallenge: doc.codeChallenge,
      codeChallengeMethod: doc.codeChallengeMethod,
      actorId: doc.actorId,
      tokenClaims: doc.tokenClaims,
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
    };
  },
});

export const purgeExpiredAnonymousOauthAuthorizationCodes = internalMutation({
  args: {
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const expired = await ctx.db
      .query("anonymousOauthCodes")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", args.now))
      .collect();

    for (const doc of expired) {
      await ctx.db.delete(doc._id);
    }

    return { purged: expired.length };
  },
});

export const countAnonymousOauthAuthorizationCodes = internalQuery({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("anonymousOauthCodes").collect();
    return { count: docs.length };
  },
});

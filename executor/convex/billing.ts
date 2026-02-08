import { StripeSubscriptions } from "@convex-dev/stripe";
import type { GenericActionCtx } from "convex/server";
import { v } from "convex/values";
import { getOneFrom } from "convex-helpers/server/relationships";
import { runSessionFunctions, type SessionId } from "convex-helpers/server/sessions";
import type { DataModel, Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action } from "./_generated/server";
import { optionalSessionIdValidator, organizationMutation, organizationQuery } from "./lib/functionBuilders";
import { canManageBilling, isAdminRole } from "./lib/identity";

const stripeClient = new StripeSubscriptions(components.stripe, {});

type DbCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

function canAccessBilling(role: string): boolean {
  return isAdminRole(role) || canManageBilling(role);
}

async function getBillableSeatCount(ctx: DbCtx, organizationId: Id<"organizations">): Promise<number> {
  const members = await ctx.db
    .query("organizationMembers")
    .withIndex("by_org_billable_status", (q) =>
      q.eq("organizationId", organizationId).eq("billable", true).eq("status", "active"),
    )
    .collect();
  return members.length;
}

async function getSeatState(ctx: DbCtx, organizationId: Id<"organizations">) {
  return await getOneFrom(ctx.db, "billingSeatState", "by_org", organizationId, "organizationId");
}

async function getBillingAccessForRequest(
  ctx: GenericActionCtx<DataModel>,
  args: { organizationId: Id<"organizations">; sessionId?: string },
) {
  if (!args.sessionId) {
    return await ctx.runQuery(internal.billingInternal.getBillingAccessForRequest, {
      organizationId: args.organizationId,
      sessionId: undefined,
    });
  }

  return await runSessionFunctions(ctx, args.sessionId as SessionId).runSessionQuery(
    internal.billingInternal.getBillingAccessForRequest,
    { organizationId: args.organizationId },
  );
}

export const getSummary = organizationQuery({
  args: {},
  handler: async (ctx) => {
    const billableMembers = await getBillableSeatCount(ctx, ctx.organizationId);
    const seatState = await getSeatState(ctx, ctx.organizationId);
    const customer = await getOneFrom(ctx.db, "billingCustomers", "by_org", ctx.organizationId, "organizationId");

    const subscription = await ctx.runQuery(components.stripe.public.getSubscriptionByOrgId, {
      orgId: String(ctx.organizationId),
    });

    const syncStatus = seatState?.syncError ? "error" : seatState?.lastSyncAt ? "ok" : "pending";

    return {
      organizationId: String(ctx.organizationId),
      customer: customer
        ? {
            stripeCustomerId: customer.stripeCustomerId,
          }
        : null,
      subscription: subscription
        ? {
            stripeSubscriptionId: subscription.stripeSubscriptionId,
            stripePriceId: subscription.priceId,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          }
        : null,
      seats: {
        billableMembers,
        desiredSeats: seatState?.desiredSeats ?? billableMembers,
        lastAppliedSeats: seatState?.lastAppliedSeats ?? null,
      },
      sync: {
        status: syncStatus,
        lastSyncAt: seatState?.lastSyncAt ?? null,
        error: seatState?.syncError ?? null,
      },
    };
  },
});

export const createSubscriptionCheckout = action({
  args: {
    organizationId: v.id("organizations"),
    priceId: v.string(),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    sessionId: optionalSessionIdValidator,
  },
  handler: async (ctx, args) => {
    const access = await getBillingAccessForRequest(ctx, args);

    if (!access || !canAccessBilling(access.role)) {
      throw new Error("Only organization admins can manage billing");
    }

    let customerId = access.customerId;
    if (!customerId) {
      const created = await stripeClient.createCustomer(ctx, {
        email: access.email ?? undefined,
        name: access.organizationName,
        metadata: {
          orgId: String(args.organizationId),
        },
        idempotencyKey: `org:${String(args.organizationId)}`,
      });
      customerId = created.customerId;

      await ctx.runMutation(internal.billingInternal.upsertCustomerLink, {
        organizationId: args.organizationId,
        stripeCustomerId: customerId,
      });
    }

    const quantity = Math.max(1, access.billableMembers);
    const successUrl = args.successUrl ?? process.env.BILLING_SUCCESS_URL ?? "http://localhost:3000/billing?success=true";
    const cancelUrl = args.cancelUrl ?? process.env.BILLING_CANCEL_URL ?? "http://localhost:3000/billing?canceled=true";

    const session = await stripeClient.createCheckoutSession(ctx, {
      priceId: args.priceId,
      customerId,
      mode: "subscription",
      quantity,
      successUrl,
      cancelUrl,
      subscriptionMetadata: {
        orgId: String(args.organizationId),
      },
    });

    await ctx.runMutation(internal.billingInternal.upsertSeatState, {
      organizationId: args.organizationId,
      desiredSeats: quantity,
      lastAppliedSeats: null,
      syncError: null,
      bumpVersion: true,
    });

    return session;
  },
});

export const createCustomerPortal = action({
  args: {
    organizationId: v.id("organizations"),
    returnUrl: v.optional(v.string()),
    sessionId: optionalSessionIdValidator,
  },
  returns: v.object({
    url: v.string(),
  }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const access: {
      role: string;
      email: string;
      organizationName: string;
      billableMembers: number;
      customerId: string | null;
    } | null = await getBillingAccessForRequest(ctx, args);
    if (!access || !canAccessBilling(access.role)) {
      throw new Error("Only organization admins can manage billing");
    }

    let customerId: string | null = access.customerId;
    if (!customerId) {
      const subscription = await ctx.runQuery(components.stripe.public.getSubscriptionByOrgId, {
        orgId: String(args.organizationId),
      });
      customerId = subscription?.stripeCustomerId ?? null;

      if (customerId) {
        await ctx.runMutation(internal.billingInternal.upsertCustomerLink, {
          organizationId: args.organizationId,
          stripeCustomerId: customerId,
        });
      }
    }

    if (!customerId) {
      throw new Error("No Stripe customer found for this organization");
    }

    return await stripeClient.createCustomerPortalSession(ctx, {
      customerId,
      returnUrl: args.returnUrl ?? process.env.BILLING_RETURN_URL ?? "http://localhost:3000/billing",
    });
  },
});

export const retrySeatSync = organizationMutation({
  requireBillingAdmin: true,
  args: {},
  handler: async (ctx) => {
    const nextVersion = await ctx.runMutation(internal.billingInternal.bumpSeatSyncVersion, {
      organizationId: ctx.organizationId,
    });

    await ctx.scheduler.runAfter(0, internal.billingSync.syncSeatQuantity, {
      organizationId: ctx.organizationId,
      expectedVersion: nextVersion,
    });

    return { ok: true, queued: true };
  },
});

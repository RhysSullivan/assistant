import { createFileRoute, Link } from "@tanstack/react-router";
import { useCustomer } from "autumn-js/react";

export const Route = createFileRoute("/billing")({
  component: BillingPage,
});

function BillingPage() {
  const { data: customer, openCustomerPortal, isLoading } = useCustomer();

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10 lg:px-8 lg:py-14">
          <div className="mb-10">
            <div className="h-8 w-28 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  const allSubs = customer?.subscriptions ?? [];
  const scheduledSub = allSubs.find((s: any) => s.status === "scheduled" && s.planId !== "free");
  const activeSubs = allSubs.filter((s: any) => s.status === "active" || s.status === "trialing");
  const paidSubs = activeSubs.filter((s: any) => s.planId !== "free");
  const activePaid = paidSubs.find((s: any) => s.canceledAt == null);
  const cancelingSub = paidSubs.find((s: any) => s.canceledAt != null);
  const currentPlan = activePaid ?? cancelingSub;
  const isCanceling = !activePaid && cancelingSub != null;
  const isSwitching = isCanceling && scheduledSub != null;
  const planId = activePaid?.planId ?? (isSwitching ? scheduledSub.planId : "free");
  const executions = customer?.balances?.executions;

  const planInfo: Record<string, { name: string; tagline: string }> = {
    free: { name: "Free", tagline: "For trying things out" },
    hobby: { name: "Hobby", tagline: "For individuals and small teams" },
    professional: { name: "Professional", tagline: "For teams that need more" },
  };
  const plan = planInfo[planId] ?? planInfo.free;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10 lg:px-8 lg:py-14">
        <h1 className="font-display text-[2rem] tracking-tight text-foreground leading-none mb-10">
          Billing
        </h1>

        {/* Current plan */}
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[0.8125rem] font-medium text-foreground leading-none">
                  {plan.name}
                </p>
                {isSwitching && (
                  <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-600 dark:text-amber-400 leading-none">
                    Switching
                  </span>
                )}
                {isCanceling && !isSwitching && (
                  <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[0.625rem] font-medium text-amber-600 dark:text-amber-400 leading-none">
                    Canceling
                  </span>
                )}
              </div>
              <p className="mt-1 text-[0.75rem] text-muted-foreground/70 leading-none">
                {isSwitching && currentPlan?.currentPeriodEnd
                  ? `Starts ${new Date(currentPlan.currentPeriodEnd).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
                  : isCanceling && currentPlan?.currentPeriodEnd
                    ? `Access until ${new Date(currentPlan.currentPeriodEnd).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
                    : currentPlan?.currentPeriodEnd
                      ? `Renews ${new Date(currentPlan.currentPeriodEnd).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
                      : plan.tagline}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {currentPlan && !isCanceling && (
              <button
                type="button"
                onClick={() => openCustomerPortal()}
                className="rounded-md px-3 py-1.5 text-[0.75rem] font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                Cancel plan
              </button>
            )}
            <Link
              to="/billing/plans"
              className="rounded-md bg-primary px-3 py-1.5 text-[0.75rem] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Manage
            </Link>
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-border/50 my-2" />

        {/* Usage */}
        {executions && (
          <div className="py-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[0.8125rem] font-medium text-foreground">Executions</p>
              <p className="text-[0.8125rem] tabular-nums text-muted-foreground">
                {executions.usage.toLocaleString()}
                <span className="text-muted-foreground/50">
                  {" / "}
                  {executions.granted.toLocaleString()} this month
                </span>
              </p>
            </div>
            {!executions.unlimited && executions.granted > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={
                    {
                      "--progress": `${Math.min(100, (executions.usage / executions.granted) * 100)}%`,
                      width: "var(--progress)",
                    } as React.CSSProperties
                  }
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive:
          "bg-destructive/10 text-destructive dark:bg-destructive/20",
        outline: "border-border text-foreground",
        muted: "bg-muted text-muted-foreground",
        get: "border-[var(--method-get)]/20 bg-[var(--method-get)]/10 text-[var(--method-get)]",
        post: "border-[var(--method-post)]/20 bg-[var(--method-post)]/10 text-[var(--method-post)]",
        put: "border-[var(--method-put)]/20 bg-[var(--method-put)]/10 text-[var(--method-put)]",
        delete:
          "border-[var(--method-delete)]/20 bg-[var(--method-delete)]/10 text-[var(--method-delete)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

function MethodBadge({ method }: { method: string }) {
  const variant =
    (
      {
        GET: "get",
        POST: "post",
        PUT: "put",
        PATCH: "put",
        DELETE: "delete",
      } as const
    )[method.toUpperCase()] ?? "outline";

  return <Badge variant={variant}>{method}</Badge>;
}

export { Badge, badgeVariants, MethodBadge };

export function slugify(input: string, fallback = "team"): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : fallback;
}

export function isAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function canManageBilling(role: string): boolean {
  return role === "owner" || role === "admin" || role === "billing_admin";
}

export function actorIdForAccount(account: {
  _id: string;
  provider: string;
  providerAccountId: string;
}): string {
  if (account.provider === "anonymous") {
    return account.providerAccountId;
  }
  return String(account._id);
}

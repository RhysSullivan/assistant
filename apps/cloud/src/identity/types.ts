export type IdentityProviderId = "workos" | "local" | (string & {});

export type IdentitySession = {
  readonly accountId: string;
  readonly email: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly organizationId: string | null;
  readonly sealedSession: string;
  readonly refreshedSession: string | null;
};

export type IdentityOrganization = {
  readonly id: string;
  readonly name: string;
};

export type IdentityMembership = {
  readonly id: string;
  readonly accountId: string;
  readonly organizationId: string;
  readonly status: string;
  readonly roleSlug: string;
};

export type IdentityMemberProfile = IdentityMembership & {
  readonly email: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
  readonly lastActiveAt: string | null;
};

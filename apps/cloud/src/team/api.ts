import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";
import { WorkOSError } from "../auth/errors";

export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  {},
  HttpApiSchema.annotations({ status: 403 }),
) {}

const TeamMember = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  email: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  role: Schema.String,
  status: Schema.String,
  lastActiveAt: Schema.NullOr(Schema.String),
  isCurrentUser: Schema.Boolean,
});

const TeamMembersResponse = Schema.Struct({
  members: Schema.Array(TeamMember),
});

const TeamRole = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
});

const TeamRolesResponse = Schema.Struct({
  roles: Schema.Array(TeamRole),
});

const InviteBody = Schema.Struct({
  email: Schema.String,
  roleSlug: Schema.optional(Schema.String),
});

const InviteResponse = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
});

const membershipIdParam = HttpApiSchema.param("membershipId", Schema.String);

const RemoveResponse = Schema.Struct({
  success: Schema.Boolean,
});

const UpdateRoleBody = Schema.Struct({
  roleSlug: Schema.String,
});

const UpdateRoleResponse = Schema.Struct({
  success: Schema.Boolean,
});

export { TeamMember, TeamMembersResponse };

export class TeamApi extends HttpApiGroup.make("team")
  .add(
    HttpApiEndpoint.get("listMembers")`/team/members`
      .addSuccess(TeamMembersResponse)
      .addError(WorkOSError),
  )
  .add(
    HttpApiEndpoint.get("listRoles")`/team/roles`
      .addSuccess(TeamRolesResponse)
      .addError(WorkOSError),
  )
  .add(
    HttpApiEndpoint.post("invite")`/team/invite`
      .setPayload(InviteBody)
      .addSuccess(InviteResponse)
      .addError(WorkOSError)
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.del("removeMember")`/team/members/${membershipIdParam}`
      .addSuccess(RemoveResponse)
      .addError(WorkOSError)
      .addError(Forbidden),
  )
  .add(
    HttpApiEndpoint.patch("updateMemberRole")`/team/members/${membershipIdParam}/role`
      .setPayload(UpdateRoleBody)
      .addSuccess(UpdateRoleResponse)
      .addError(WorkOSError)
      .addError(Forbidden),
  ) {}

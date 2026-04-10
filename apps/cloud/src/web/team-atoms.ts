import { CloudApiClient } from "./client";

export const teamMembersAtom = CloudApiClient.query("team", "listMembers", {
  timeToLive: "30 seconds",
});

export const teamRolesAtom = CloudApiClient.query("team", "listRoles", {
  timeToLive: "5 minutes",
});

export const inviteMember = CloudApiClient.mutation("team", "invite");

export const removeMember = CloudApiClient.mutation("team", "removeMember");

export const updateMemberRole = CloudApiClient.mutation("team", "updateMemberRole");

// ---------------------------------------------------------------------------
// User / Team / Invitation management
// ---------------------------------------------------------------------------

import { eq, and } from "drizzle-orm";

import { users, teams, teamMembers, invitations } from "./schema";
import type { DrizzleDb } from "@executor/storage-postgres";

export type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;

export const makeUserStore = (db: DrizzleDb) => ({
  // --- Users ---

  upsertUser: async (user: { id: string; email: string; name?: string; avatarUrl?: string }) => {
    const [result] = await db
      .insert(users)
      .values(user)
      .onConflictDoUpdate({
        target: users.id,
        set: { email: user.email, name: user.name, avatarUrl: user.avatarUrl },
      })
      .returning();
    return result!;
  },

  getUser: async (userId: string) => {
    const rows = await db.select().from(users).where(eq(users.id, userId));
    return rows[0] ?? null;
  },

  getUserByEmail: async (email: string) => {
    const rows = await db.select().from(users).where(eq(users.email, email));
    return rows[0] ?? null;
  },

  // --- Teams ---

  createTeam: async (name: string) => {
    const [team] = await db.insert(teams).values({ name }).returning();
    return team!;
  },

  getTeam: async (teamId: string) => {
    const rows = await db.select().from(teams).where(eq(teams.id, teamId));
    return rows[0] ?? null;
  },

  addMember: async (teamId: string, userId: string, role: string = "member") => {
    const [member] = await db
      .insert(teamMembers)
      .values({ teamId, userId, role })
      .onConflictDoNothing()
      .returning();
    return member ?? null;
  },

  removeMember: async (teamId: string, userId: string) => {
    const result = await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .returning();
    return result.length > 0;
  },

  listMembers: async (teamId: string) => {
    const rows = await db
      .select({
        userId: teamMembers.userId,
        role: teamMembers.role,
        createdAt: teamMembers.createdAt,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, teamId));
    return rows;
  },

  getTeamsForUser: async (userId: string) => {
    const rows = await db
      .select({
        teamId: teamMembers.teamId,
        role: teamMembers.role,
        teamName: teams.name,
        teamCreatedAt: teams.createdAt,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, userId));
    return rows;
  },

  // --- Invitations ---

  createInvitation: async (teamId: string, email: string, invitedBy: string) => {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const [invitation] = await db
      .insert(invitations)
      .values({ teamId, email, invitedBy, status: "pending", expiresAt })
      .returning();
    return invitation!;
  },

  getPendingInvitations: async (email: string) => {
    const rows = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.email, email), eq(invitations.status, "pending")));
    return rows.filter((r) => r.expiresAt > new Date());
  },

  getTeamInvitations: async (teamId: string) => {
    const rows = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.teamId, teamId), eq(invitations.status, "pending")));
    return rows.filter((r) => r.expiresAt > new Date());
  },

  acceptInvitation: async (invitationId: string) => {
    const [updated] = await db
      .update(invitations)
      .set({ status: "accepted" })
      .where(eq(invitations.id, invitationId))
      .returning();
    return updated ?? null;
  },

});

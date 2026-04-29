-- Switch tool_policy.position to fractional-indexing strings (Jira
-- lexorank style). Lex-ordered text scales without precision limits;
-- the previous numeric scheme would eventually collide on repeated
-- reorders between the same two rows.
--
-- The existing rows hold floats that can't round-trip into the
-- fractional-indexing alphabet, and the feature isn't shipped yet, so
-- truncate before altering. Anyone on the feature branch will need to
-- recreate their dev policies.
TRUNCATE TABLE "tool_policy";--> statement-breakpoint
ALTER TABLE "tool_policy" ALTER COLUMN "position" SET DATA TYPE text;

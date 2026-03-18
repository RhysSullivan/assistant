---
name: postgres-incident-triage
description: Triage production PostgreSQL incidents involving lock contention, slow queries, or saturation. Use when the user asks for database incident diagnosis or immediate next steps.
compatibility: Assumes SQL access to pg_stat_activity and pg_locks.
allowed-tools: Bash(psql:*) Read
---

# Postgres Incident Triage

## When to use this skill

Use this skill for live operational diagnosis of PostgreSQL incidents, especially when
latency spikes or blocked sessions appear.

## Workflow

1. Read `references/error-codes.md` for common failure patterns.
2. Use `scripts/blocked-session-query.sql` to inspect blockers and waiters.
3. Separate symptoms from root cause: CPU saturation, I/O pressure, lock chains, or
   connection pileups.
4. Recommend the least-destructive mitigation first.
5. If proposing session termination, identify the blocker and expected blast radius.

## Output rules

- Summarize the current condition in one paragraph.
- List the most likely root causes in order.
- Provide immediate next commands before longer-term remediation.

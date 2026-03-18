---
name: release-notes-writer
description: Draft product release notes from commits, changelogs, and issue summaries. Use when the user asks for release notes, launch notes, or upgrade summaries.
compatibility: Requires markdown output and access to bundled templates.
allowed-tools: Read Write
---

# Release Notes Writer

## When to use this skill

Use this skill when the user wants polished release notes, changelog summaries, or
customer-facing upgrade notes.

## Workflow

1. Read the release template in `assets/release-template.md`.
2. Read the voice and structure rules in `references/style-guide.md`.
3. Group changes into user-facing themes instead of commit-by-commit narration.
4. Prefer concrete impact statements over internal implementation details.
5. Call out breaking changes, migrations, and feature flags explicitly.

## Output rules

- Start with a short overview paragraph.
- Include sections only for categories that actually changed.
- End with a short rollout or migration note when relevant.
- Keep internal ticket IDs out of the final draft unless the user asked for them.

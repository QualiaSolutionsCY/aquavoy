# Onboarding — Existing Dev Process

## Issue tracker
GitHub: https://github.com/QualiaSolutionsCY/aquavoy
No GitLab, no local trackers (.scratch/, docs/issues/, ISSUES.md absent).
Use GitHub Issues; Qualia also keeps .planning/decisions/ + tracking.json.

## Existing labels
Default GitHub label set (no custom labels yet).

| Canonical        | Existing label | Status  |
|------------------|----------------|---------|
| bug              | bug            | present |
| enhancement      | enhancement    | present |
| needs-triage     | —              | MISSING |
| needs-info       | question       | mapped  |
| ready-for-agent  | —              | MISSING |
| ready-for-human  | help wanted    | mapped  |
| wontfix          | wontfix        | present |

Other present: documentation, duplicate, good first issue, invalid.
Create the 2 missing canonical roles (needs-triage, ready-for-agent).

## Domain docs
README.md (project root) — stack, architecture seams, API table, setup.
No CONTEXT.md/GLOSSARY.md/docs/. Qualia creates .planning/CONTEXT.md.

## Existing agent files
None found (no CLAUDE.md, AGENTS.md, .cursor/, .cursorrules, .aider.conf.yml, .continue/).
Qualia APPENDs substrate, never overwrites.

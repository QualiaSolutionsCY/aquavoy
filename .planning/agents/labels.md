# Label Mapping (canonical ↔ existing)

GitHub default label set; no custom labels yet.

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

**Action:** create the 2 missing canonical roles when first needed:
```bash
gh label create needs-triage --description "Awaiting triage" --color ededed
gh label create ready-for-agent --description "Ready for an agent to pick up" --color 0e8a16
```

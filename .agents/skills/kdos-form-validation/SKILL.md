---
name: kdos-form-validation
description: Validate KDOS business forms, tables, field mappings, permissions, queries, and Excel import/export with focused checks matched to change risk. Use when changing or accepting business data entry and table workflows across KDOS modules.
---

# KDOS form and table validation

Use this skill when implementing or reviewing a KDOS business form, table, field, filter, permission, or Excel workflow. Its goal is to establish that the changed behavior is correct and usable without testing unrelated areas.

## Workflow

1. Read the applicable project instructions and module-specific Skills/contracts. Inspect the changed code, callers, existing tests, and worktree before choosing checks. Keep established module rules authoritative; examples in this Skill do not replace them.
2. Define the user-visible behavior and data path affected. For field changes, trace only the relevant links among persistence/entity mapping, API DTO, contracts, table, create/edit/detail views, filters, import, and export. A display-label-only change does not imply a schema change.
3. Select L1, L2, or L3 in [validation-levels.md](references/validation-levels.md). Run the smallest existing checks that cover the change; add broader checks only when the risk or shared surface justifies them. Do not create duplicate test infrastructure or repeat passing checks without a reason.
4. For UI interactions, use the project's existing browser tooling when available and useful. Establish which build/environment the browser is hitting. Report code checks, local browser checks, deployment, and production browser acceptance as separate facts.
5. For database behavior, use existing isolated test databases/transactions and migration tooling. Do not write synthetic rows to production. A production read-only check is not evidence of production write behavior.
6. Review the diff for scope, secrets, generated artifacts, unintended business-code changes, and accurate report status. Follow user authorization and the repository's Git/deployment rules; commit, push, and deploy are distinct actions.

## Invariants

- Verify field identity, label, order, type, requiredness, editability, null/zero handling, save and reload behavior only where affected. Preserve stable field keys when labels change.
- Validate both UI affordances and server-side authorization. Hiding a button is not an authorization check; check the API/data/field scope when the change touches permissions.
- For save workflows, cover create or update, read/query, reload and display when safe and relevant. Check validation, date/decimal precision, duplicate handling, and overwrite/concurrency behavior according to that module's contract.
- For Excel changes, compare template/import/export headers and ordering to the business contract; check parsing, type/format, validation feedback, filtering, persisted values, and permissions as applicable. All spreadsheet imports must use the shared encrypted-file detector before parsing; encrypted files return exactly `该文件被加密,请解密后再导入.`
- Reuse KDOS organizations, users, permission, audit, and tenant boundaries. Check department/role/user scope only when affected. Keep system audit fields system-managed and separate from business fields.
- Preserve explicitly confirmed module-specific rules. Examples include order allocation duplicate semantics, equipment fault-reason choices, and review due date V2's 11-column import / 13-column export. Do not generalize an example into a rule for other modules.
- Avoid routine full-suite runs, full-database backups, production mutations, or deployment for low-risk display changes. Escalate checks in proportion to data loss, migration, bulk-write, delete, and cross-module risk.
- Interpret absolute restrictions in context. Check the current task and prior explicit authorization before concluding an action is forbidden. If an actual instruction conflict blocks a necessary action, explain the exact conflict and ask for the smallest clarification; do not expand a restriction beyond its stated scope.

## References

- Read [acceptance-checklist.md](references/acceptance-checklist.md) for the applicable review dimensions.
- Read [validation-levels.md](references/validation-levels.md) to choose focused verification by risk.
- Use [report-template.md](references/report-template.md) for a short evidence-based completion report.

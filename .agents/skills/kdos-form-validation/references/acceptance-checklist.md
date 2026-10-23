# Acceptance checklist

Apply only the sections affected by the change. The module's established contract takes precedence over this generic checklist.

## Fields and persistence

- [ ] Stable field key and label map to the correct stored value.
- [ ] Type, order, requiredness, defaults, null/empty/zero behavior, and precision match the business contract.
- [ ] Create, edit, read-only, hidden, and detail presentation are correct where applicable.
- [ ] Save, query, reload, and display preserve the intended value without accidental overwrite.
- [ ] DTO, contracts, API validation, entity/repository mapping, filters, and import/export are updated only where the data path requires it.
- [ ] A label-only change has not caused an unnecessary schema or migration change.

## Forms and tables

- [ ] Required-field and cross-field errors are clear and prevent invalid writes.
- [ ] Search, sort, pagination, filters, and counts target the intended fields and records.
- [ ] Empty results, loading, and failure states remain understandable.
- [ ] Row identity and optimistic/concurrency behavior follow the module contract.

## Excel

- [ ] Template header names/order and examples or dictionaries match the current contract.
- [ ] Import handles relevant cell types, dates, decimals, formulas, aliases, duplicates, and row-level errors.
- [ ] Encrypted-file detection runs before parsing and preserves the exact user-facing message.
- [ ] Preview and confirmation enforce the same business validation and authorization; confirmation rechecks mutable conditions.
- [ ] Export contains the expected business labels, ordering, values, formats, filters, and complete matching record set.
- [ ] Technical IDs and audit columns appear only when the business contract requires them; system audit values are not user-writable.

## Permissions, tenant scope, audit

- [ ] Visible actions match the user's effective resource/field/data permissions.
- [ ] Direct API requests enforce the same permissions and tenant/data scope.
- [ ] Organization options and saved organization IDs use the existing canonical source.
- [ ] Critical writes record required audit data; system-managed fields remain system-managed.

## Evidence and release status

- [ ] Selected checks directly exercise the changed behavior; unrelated suites were not repeated without cause.
- [ ] Browser evidence identifies the environment/build and covers only the changed UI path.
- [ ] Isolated persistence checks do not leave fixtures behind; production data was not used for synthetic writes.
- [ ] Report states PASS, FAIL, or BLOCKED with the evidence and any unverified scope.
- [ ] Local verification, production deployment, and production browser acceptance are reported separately.

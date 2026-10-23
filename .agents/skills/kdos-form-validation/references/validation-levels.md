# Validation levels

Choose the lowest level that covers the changed behavior. Increase the level when the change crosses a higher-risk boundary; do not treat the levels as mandatory test counts.

## L1 — Display-only

Examples: label, spacing, column width, helper text, nonfunctional layout.

Check the diff and the affected view/component test or a focused browser view. Confirm the actual text/layout and that adjacent interactions still work if the change touches them. Do not add database, migration, full-suite, backup, or deployment work by default.

## L2 — Business behavior

Examples: field or form behavior, query/filter, validation, permissions, Excel, or a business workflow change.

Run the relevant unit/component/API checks and typecheck or build only where the changed surface requires them. For persistence, use an existing isolated database/transaction test. For UI or interaction changes, use the existing browser path when available. Cover the essential create/update → query → reload/display path when safe and relevant. Verify permission and export/import intersections when affected.

## L3 — High-risk data or boundary change

Examples: destructive or bulk writes, historical data migration, important schema changes, concurrency-sensitive behavior, or cross-module contracts.

Add migration/rollback or forward-only behavior checks, representative data reconciliation, transaction/idempotency/concurrency checks, authorization and tenant-boundary checks, and focused regression across dependent modules. Assess backup needs from the actual data-loss risk and the project's deployment rules; do not impose a full-database backup automatically. Production verification should be read-only unless separately authorized and safe. State irreversible effects and evidence gaps plainly.

## Choosing tools

Prefer the repository's existing targeted Jest/component tests, PostgreSQL integration scripts, and Playwright/Chrome E2E paths. Check package scripts and the documented environment before running them. Use `scripts/deploy.sh check` for version consistency only when deployment state is relevant; it is not a substitute for user-visible acceptance. Follow the runbook for any deployment or migration, and never bypass a release gate.

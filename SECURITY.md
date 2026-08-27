# KDOS security

## Trust boundaries

- Nginx is the only published application endpoint; API and PostgreSQL stay on the internal Compose network.
- PostgreSQL hosts a retained legacy database and a separate `kdos` database. Do not delete or overwrite the legacy database without explicit user approval.
- Authentication is currently the compatibility local JWT/API-key path. `packages/auth` defines the Keycloak OIDC production boundary; authorization remains in KDOS.
- Every request is untrusted, including authenticated Web, Excel, T+, system-job and future AI input.

## Authorization and tenancy

- Planning actions use explicit `planning.*` permissions; lock, unlock and publish are distinct grants.
- Field access supports `HIDDEN`, `READONLY`, `EDITABLE`, and `MASKED`.
- The API rechecks action and field permissions. UI visibility is not a security control.
- Per-table permission groups retain stable subject IDs. Direct members, organization membership and ordinary-role membership are resolved again when issuing a token; disabled groups stop contributing claims without deleting other grants.
- New IAM/Planning/Audit/Integration tables have `tenant_id` and RLS. Repository transactions set `app.tenant_id`, and SQL also includes tenant predicates.
- Identity-provider `sub` values are stored in `iam.identities`; they never replace KDOS UUIDv7 business IDs.

## Data integrity

- Published and locked plans are immutable. State changes are transactional and audited.
- Collaborative writes carry `expectedVersion`; stale writes return 409.
- Import confirmation locks the job/version, writes in one transaction and is idempotent.
- Quantities and amounts use exact decimals and PostgreSQL `numeric`.
- Critical changes capture actor, action, resource, before/after values, reason, source, request/trace IDs and IP where available.

## Files

- `ObjectStorage` isolates Planning from storage implementation. Phase one uses `LocalObjectStorage`; keys are generated, path traversal is rejected, and files are written with restricted permissions.
- Images are MIME allowlisted to JPEG/PNG/WebP, size-limited, decoded through Sharp when compression is needed, and capped at two per item.
- Static uploads currently inherit application access at the Nginx route; do not store secrets or identity documents there. Signed/private object delivery is phase-two work.
- Excel accepts standard `.xlsx`/`.csv`; do not bypass DRM. Temporary plaintext and snapshots containing business data must not be committed.

## Secrets and logging

- Never commit `.env`, database passwords, JWT secrets, API keys, tokens, T+ credentials or business snapshots.
- Access tokens and credentials must not appear in logs, audit JSON, WebSocket messages or error responses.
- WebSocket events carry invalidation metadata only, not full plan rows.
- Rotate any secret that is accidentally disclosed and remove it from history where required.

## Operations

- Back up both databases and uploads before migrations/upgrades; verify SHA256 and restore only into a validated target.
- Do not run `docker compose down -v`, destructive database cleanup or recursive deletion against broad paths.
- Run dependency, lint, type, unit, build and Playwright checks before release.
- Report vulnerabilities privately to the repository owner; include affected route/module, reproduction, impact and recommended mitigation without production credentials.

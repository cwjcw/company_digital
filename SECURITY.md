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
- System and module administrator grants are tenant-scoped and are not ordinary roles or permission groups. Only the built-in `admin` account can change system administrators; any system administrator can change module administrators; module administrators can only view both lists. The `admin` grant cannot be removed, transferred or disabled. Other System Management operations reject every non-system administrator. A module administrator can manage permission groups only when the requested table registry entry belongs to that exact module.
- Administrator grants are re-resolved for every authenticated request. The browser refreshes its live session before rendering administrator-only navigation, while backend authorization remains authoritative.
- New IAM/Planning/Audit/Integration tables have `tenant_id` and RLS. Repository transactions set `app.tenant_id`, and SQL also includes tenant predicates.
- Identity-provider `sub` values are stored in `iam.identities`; they never replace KDOS UUIDv7 business IDs.

## Data integrity

- Published and locked plans are immutable. State changes are transactional and audited.
- Collaborative writes carry `expectedVersion`; stale writes return 409.
- Import confirmation locks the job/version, writes in one transaction and is idempotent.
- Quantities and amounts use exact decimals and PostgreSQL `numeric`.
- Critical changes capture actor, action, resource, before/after values, reason, source, request/trace IDs and IP where available.
- Equipment APIs enforce independent table actions and stable-UUID division scopes on reads and writes. Status dates are server-validated against the current Asia/Shanghai day and its preceding six days; browser date controls are convenience only. Equipment/status deletes are soft deletes and all changes use optimistic versions plus audit records.

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
- SMTP credentials live only in the ignored, mode-`600` server file `.env.smtp`; temporary passwords and user passwords are never logged or audited in plaintext. User passwords and password-reset request material are stored only as bcrypt hashes.
- Authenticated password changes require a valid recovery email and save the latest submitted address on the user account. Password reset requires that exact username/email pair; it never overwrites the recovery email. Each wrong email attempt is transactionally counted and audited, the response reports the remaining attempts, and the reset function is locked on the tenth failure. A successful verification clears the counter, generates an exact eight-character temporary password containing letters and digits, sends it only to the saved email, stores only bcrypt hashes, revokes existing refresh tokens, and requires an immediate password change after login. An authenticated password change or an administrator email/password update clears the reset lock.

## Operations

- Back up both databases and uploads before migrations/upgrades; verify SHA256 and restore only into a validated target.
- Do not run `docker compose down -v`, destructive database cleanup or recursive deletion against broad paths.
- Run dependency, lint, type, unit, build and Playwright checks before release.
- Report vulnerabilities privately to the repository owner; include affected route/module, reproduction, impact and recommended mitigation without production credentials.

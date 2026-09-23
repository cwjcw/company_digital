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
- Access JWTs contain only the stable user subject and token metadata. Roles, administrator grants, table operations, field permissions and data scopes are never embedded in the bearer header; the API resolves them from current database state on every protected request. This keeps permission growth independent of proxy header limits and makes revocation effective immediately.
- New IAM/Planning/Audit/Integration tables have `tenant_id` and RLS. Repository transactions set `app.tenant_id`, and SQL also includes tenant predicates.
- Identity-provider `sub` values are stored in `iam.identities`; they never replace KDOS UUIDv7 business IDs.

## Data integrity

- Published and locked plans are immutable. State changes are transactional and audited.
- Collaborative writes carry `expectedVersion`; stale writes return 409.
- Import confirmation locks the job/version, writes in one transaction and is idempotent.
- Quantities and amounts use exact decimals and PostgreSQL `numeric`.
- Critical changes capture actor, action, resource, before/after values, reason, source, request/trace IDs and IP where available.
- Equipment APIs enforce independent table actions and stable-UUID division scopes on reads and writes. Status dates are server-validated against the current Asia/Shanghai day and its preceding six days; browser date controls are convenience only. Equipment/status deletes are soft deletes and all changes use optimistic versions plus audit records.
- 事业部订单评审的交期编辑同时校验表更新、字段编辑和源数据范围；单条/批量交期确认还校验滚动计划表的导入或更新权限及目标数据范围。确认命令使用客户端 UUID 幂等、逐行乐观版本、租户事务和源/目标审计；WebSocket 只发送两张表的失效元数据。
- 主计划系统 18 张业务表的 `updated_by` 和 outbox `actor_user_id` 使用 `users.id` 稳定 UUID 外键；系统任务使用禁用登录的固定系统主体。业务写入与 `mps_reconciliation_outbox` 入队处于同一租户事务，消费者以 `FOR UPDATE SKIP LOCKED` 领取任务并重试。
- KDOS 通知的 `notification_rules`、`notification_outbox`、`notification_delivery_logs` 均带 `tenant_id`、RLS policy 和显式租户条件；outbox 使用 `tenant_id + dedup_key` 幂等唯一约束，内部 API 以专用 token、tenant 和 worker header 保护，领取和状态回写必须校验 worker 与租户。规则不匹配的事件被隔离为不可重试状态，不能直接交给 Dispatcher；责任人缺少 `wechat_user_id` 时只记录 `SKIPPED_MISSING_WECHAT_ID`，不阻塞其他责任人。企业微信 adapter 不访问数据库、不解析业务接收人，secret 只允许由 `basic_code` 自己的环境加载；验证阶段必须通过环境门禁只允许崔玮杰，未通过门禁的接收人不会调用企业微信。
- 主计划 Excel 导入是仅更新已有记录的两阶段流程。预览与确认均校验表权限、字段权限、数据范围和乐观版本，确认令牌绑定租户、用户、资源、文件摘要和有效期；解析前必须执行统一加密文件检测，整批写入及审计必须原子提交。

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

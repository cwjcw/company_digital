# KDOS Knowledge 2.0 Acceptance

Date: 2026-10-09 (Asia/Shanghai).
Status: PASS within the explicitly authorized administrator-only production acceptance scope. All23 in-scope checks passed using real Chrome and real production APIs. Employee checks11/13 and effective access tests with another authenticated employee account were excluded by user direction.

## 1. Phase 1 retirement

The new migration drops `knowledge_categories`, `knowledge_articles`, `knowledge_article_versions`, `knowledge_version_attachments`, `knowledge_attachments`, `knowledge_article_tags`, and `knowledge_tags`, then replaces the applicable attachment/tag names with the new Page model. It drops the old category-depth and immutable-snapshot functions. The executed Phase 1 migration `1722920084000-KnowledgeBasePhaseOne.ts` is unchanged.

Old Category/Article API routes, UI routes, categories screen, contracts, and resource declarations are retired. Old `knowledge-categories`/`knowledge-articles` permission declarations are removed and their dedicated permission groups disabled; ordinary roles, users, other modules' grants, and AuditLog are retained. Knowledge unit/UI/database/Chrome tests now target Space/Page rather than the old business contract. No compatibility adapter or dual model exists.

Pre-upgrade production check found zero articles, versions, and attachments, two categories, and no external foreign-key dependency. No other module's business schema is dropped.

## 2. Architecture

Space is the knowledge domain and membership boundary. Every directory, title-only node, body, and child is a Page. Parent links support arbitrary tree depth (validated with 12 additional nested levels). The working canonical JSON/text/hash is separate from append-only immutable published versions. Readers use published snapshots. Every ancestor restricts effective access. Private attachments are linked to Page and snapshotted at publication. Tags are independent of tree position. Published-only PostgreSQL search and document preview/command-based import share the authorization boundary.

Existing TypeORM compatibility infrastructure in `four_department_tracker.public`, identity, ordinary roles, organizations, platform permissions/filters, AuditLog, ObjectStorage, TipTap, KdosDataTable, and Portal are reused. No AI/RAG/vector tables or extra infrastructure are introduced.

## 3. Database

New migration: `Knowledge2SpacePageModel1722920085000`.

Ten tables: `knowledge_spaces`, `knowledge_space_access`, `knowledge_pages`, `knowledge_page_access`, `knowledge_page_versions`, `knowledge_attachments`, `knowledge_page_version_attachments`, `knowledge_tags`, `knowledge_page_tags`, `knowledge_storage_cleanup`. All use UUIDv7 IDs, tenant isolation, audit columns, and optimistic versions. `knowledge_page_read_model` is a security-invoker published-only view.

Composite tenant/Space parent FKs enforce same-Space links, with deferrable parent and published-version links. Constraints cover nonempty titles/codes, unique slugs/codes/membership, state/subject/level enums, sizes, and positive versions. A tenant advisory lock and recursive trigger prevent cycles. Version mutation/deletion is rejected except in the authorized purge transaction; later inserts into an existing version's file snapshot are also rejected.

Indexes cover Space lists, parent/Space tree ordering, status, memberships, tags, attachments, versions, and pg_trgm GIN `idx_knowledge_pages_search`. Each table enables RLS with `app.tenant_id`, alongside explicit tenant predicates in services. Only the stable HR Space and ALL/VIEWER membership are initialized; there are no business pages or new ordinary-user platform grants. Fresh replay and old-to-new migration are tested separately. Production verification confirms 10 RLS tables, 22 foreign keys and 35 indexes including primary/unique indexes.

## 4. Permissions

Resources: `knowledge-spaces`, `knowledge-pages`; module: `knowledge`. Existing system and Knowledge module administration applies. Other module administrators gain no Knowledge elevation. Platform table actions, field permissions, and data scopes remain required for ordinary members; publish/archive reuse update and trash/purge reuse delete.

Membership levels are VIEWER, EDITOR, FULL_ACCESS. USER/ROLE/ORGANIZATION/ALL identities are stored by stable IDs. Organization and role membership is evaluated from the current platform directory. Effective access intersects Space and every restricted ancestor; a child ALL grant cannot broaden a private parent. Working drafts require EDITOR plus platform update. History also checks current ancestry and historical access snapshots. Export intersects read/export scopes. Tree/search/detail/files/history/options/platform candidates use the same authorization service, with field pruning and no hidden-body search side channel.

## 5. API

Base `/api/v1/knowledge`; all new routes use existing AuthGuard. The complete route list follows. Existing-record writes require expectedVersion. Default reads use published mode; working/trash and historical UUIDs require the corresponding authority.

| Method | Path | Behavior |
|---|---|---|
| GET / POST | `/spaces` | Authorized list / create |
| PATCH / DELETE | `/spaces/:id` | Update/archive/restore / archive |
| GET / PATCH | `/spaces/:id/access` | Read / update Space membership |
| GET | `/spaces/:id/tree` | Lazy roots/children; server pagination |
| GET | `/pages / /search` | Page list / published-only search and filters |
| POST | `/pages` | Immediately create persistent draft |
| GET / PATCH / DELETE | `/pages/:id` | Detail / autosave / trash |
| PATCH | `/pages/:id/access` | Restriction or inheritance |
| POST | `/pages/:id/move` | Move and sort |
| POST | `/pages/:id/publish` | Append immutable published version |
| POST | `/pages/:id/archive / /unarchive` | Archive / restore archive |
| POST | `/pages/:id/restore` | Restore trash batch |
| DELETE | `/pages/:id/permanent` | Purge authorized trashed subtree |
| GET | `/pages/:id/versions` | Version history |
| GET | `/pages/:id/versions/:versionId` | Immutable version detail |
| POST | `/pages/:id/attachments` | Immediate private upload |
| GET / DELETE | `/attachments/:id` | Authorized download / detach from working draft |
| POST | `/attachments/cleanup` | Detached/crash orphan cleanup and retry |
| POST | `/imports/preview / /imports/commit` | Preview conversion / command-created draft |
| GET | `/pages/:id/export?format=md or html` | Single-page export |
| GET | `/options` | Authorized platform membership pickers |



## 6. Web

Portal entry, Space sidebar, lazy paginated Page tree, published/working navigation, reader, breadcrumb, heading TOC, TipTap editor, version history, private files, search, imports, Space settings/members, archive and trash are available. Page menus support child creation, move/ordering, ACL, history, archive/trash, links and Markdown/HTML downloads. The editor provides H1/H2/H3, marks, lists, quotes/callouts, links, tables, code, images, files, horizontal rule, undo/redo and pasted image upload. No new UI framework is used.

## 7. Autosave

POST Page creates a persistent DRAFT/pageId before the editor opens, so upload needs no manual save. A 1200ms debounce and one serialized version stream handle save/upload/publish. Title/body/tags/metadata use expectedVersion; 409 stops retry and preserves local edits instead of overwriting another user. Ordinary failures retain input and offer retry. Navigation and publish flush first, and pending file operations block unsafe navigation. Failed drafts remain in account/permission-scoped memory on module navigation; logout flushes and clears them. Browser unload warns, but unsaved content is not persisted to localStorage and may be lost after browser termination.

## 8. Import and export

DOCX (Mammoth), Markdown/GFM (Marked), HTML (sanitize-html/node-html-parser) all follow preview -> Space/parent/title/tags/inherited or restricted ACL -> commit as DRAFT -> manual publish. They normalize through the same canonical body, trusted text and hash. Typical paragraphs/headings/marks/lists/links/tables/code and supported embedded images are retained. Unified encryption detection precedes parsing and retains the exact required Chinese message.

Limits: 20MB source; converted body 2MB; canonical body 500KB/10,000 nodes/depth25; Office entries 30MB each/100MB total/2,000 files with actual decompression checks; max20 page files/images. External/relative images are not fetched; users upload them separately. DOCX pagination, headers/footers, floating layout, exact fonts and HTML CSS are not preserved. Preview tokens are tenant/user-bound, consumed on success, expire after10min, and are lost on restart. Excel content import is not implemented.

Single-page Markdown/HTML exports include authorized images as data URIs; other files are downloaded separately via authenticated APIs. DOCX/PDF export and text diff are not implemented. Platform XLSX export reuses existing infrastructure and all filtered published rows rather than the visible page.

Runtime dependencies added: API mammoth, marked, node-html-parser, sanitize-html; Web @tiptap/extension-table. API development dependency @types/sanitize-html. Frozen lockfile install passed. Formatting used pnpm dlx and added no formatter dependency.

## 9. Search

Existing pg_trgm is retained. Current published text/title/tags/Space/ancestor titles feed a mutable GIN projection; drafts never enter it. Parent publication, move and Space rename refresh projections transactionally without modifying published content snapshots. ACL/tenant/status/filtering precede count, ranking and pagination. Result includes title/snippet/Space/authorized breadcrumb/tags/publisher/time/relevance subject to field permissions. The actual isolated PostgreSQL EXPLAIN ANALYZE chooses `idx_knowledge_pages_search`; full evidence is in `KNOWLEDGE_2_DATABASE_VALIDATION.json`.

## 10. Security

Strict canonical JSON, safe React rendering and HTML sanitization reject scripts/events/dangerous URLs. Document parsers do not fetch external resources. Sharp verifies/reencodes images; signature/type checks, upload/decompression bounds and filename sanitization reject spoofed/unsafe files. Private objects have no public URL, and download requires AuthGuard, tenant, platform fields/scopes and current/historical ACL. File responses use no-store/nosniff. History/file ID guessing, draft leakage, descendant widening, tenant bypass, path traversal and hidden-field search are covered.

Detached files needed by published history remain. Authorized purge removes subtree versions/files/relations while retaining audit metadata; storage failures retain persistent retry tasks. Admin-only enumeration of the tenant's private ObjectStorage prefix reconciles crash-before-DB orphan files under the same lock as uploads, leaving referenced and other-tenant files intact. Current local storage supports enumeration. Scheduled reconciliation targets the configured default tenant; additional tenants can use the admin cleanup command. The expressly authorized administrator credentials were consumed transiently at runtime for actual Chrome login. No credential values, tokens, storage state, traces, video or screenshots were persisted in source or evidence; no credentials or account grants were changed and no temporary production JWT was generated.

## 11. Tests

Initial delivery: API89 suites/777 tests PASS with one existing skip; other workspace43 PASS; isolated PostgreSQL61 scenarios/91 metadata audits and all84 fresh-install migrations PASS. API/domain/database code is unchanged by this administrator acceptance follow-up.

Final Web regression:32 files/235 tests PASS (`pnpm --filter @tracker/web exec vitest run --maxWorkers=2 --testTimeout=15000`). Focused editor/cache/autosave:23 PASS. The initial unbounded worker run hit11 existing5-second timeouts across four unrelated modules; the final complete run with two workers/15-second environment allowance passed all235 tests without changing those modules or their assertions. Root build passed after the cache fix; final Web typecheck, lint, build and Node24 deploy builds passed after the TipTap fix. git diff --check passed. Existing Node22 engine, Portal fast-refresh, Ant Design and bundle-size warnings remain.

Final Chrome UI fixtures:3 PASS/1 environment-gated login case SKIP (`pnpm --filter @tracker/web exec playwright test e2e/knowledge-ui.spec.ts`). Separately, the dedicated recording-free production Chrome acceptance used the authorized administrator login and no API interception:23 actual checks PASS, listed in section14 and `KNOWLEDGE_2_ADMIN_ACCEPTANCE.json`. Its credentials came only from transient stdin; no runtime credential file or actual values were added to the repository. Fixtures are distinct from real production account checks.

The real acceptance found and reproduced an editor race: cached working versions could initialize a new session, and TipTap's editable/busy toggle emitted a spurious content update, creating an extra PATCH after publication. The entry now waits for the working refetch; editable transitions suppress document update events. Two regression tests cover cached version initialization and actual TipTap availability toggles; real production V1 -> working edit -> V2 -> V1 history/files subsequently passed. Genuine409 handling and local-text retention remain.

Platform XLSX/DB evidence from the initial release still proves4,000 matching published rows export despite a100-row visible page, authorized filtering/order, immutable versions, ACL/tenant isolation and GIN index use. No new migration or dependency was needed for these two frontend fixes.

## 12. Backup / migration

The existing `./scripts/migrate.sh` first backed up both production databases and uploads at 2026-10-08 18:44:41 (Asia/Shanghai), checked both dumps with pg_restore --list, then successfully applied and committed `Knowledge2SpacePageModel1722920085000`. It did not run seed. SHA256 rechecks and uploads archive listing passed. The previous Knowledge migration remains in the ledger and unchanged in source.

| Backup path | SHA256 |
|---|---|
| `/data/automation/code/work/PMC/knweb/data/backups/four_department_tracker_20261008_184441.backup` | `3918333ee709ce05ab892bafde1d39f947867485486714c2d5c06a1d5445bce1` |
| `/data/automation/code/work/PMC/knweb/data/backups/kdos_20261008_184441.backup` | `270b37bc07b88a433f6f69f93b604a44fa38f155c0c171e5a72a20b11122934e` |
| `/data/automation/code/work/PMC/knweb/data/backups/uploads_20261008_184441.tar.gz` | `b02ccb3b322c497e6181ca830fd8670171eaa2e6619699c0182a25984da50310` |


SHA256 manifest: `outputs/KNOWLEDGE_2_BACKUP_SHA256.txt`. Existing PostgreSQL container, bind mount, network, image and host port were retained. No down-v/volume removal/prune was used. Automatic migration down is intentionally prohibited: restore the verified pre-upgrade backups only with post-upgrade writes accounted for.

Follow-up backups (both pg_restore --list checks, uploads archive listing and SHA256 rechecks passed). First cache-fix backup:20261009_124217; manifest contains its three paths/hashes. Final TipTap-fix backup:

| Backup path | SHA256 |
|---|---|
| `data/backups/four_department_tracker_20261009_124902.backup` | `f9f2a16efe802caf0403162264feabeb84fdc1cb5385abed897d5e03672b92ff` |
| `data/backups/kdos_20261009_124902.backup` | `a7adc4ac0a473559c2c1b605ce19a0aae0d15a525976a59698eb05e70208de9d` |
| `data/backups/uploads_20261009_124902.tar.gz` | `47aee68703c1f5f6555fac266ec2b6980594c5a3aba1fbcdc6d56bd7f447a65f` |

## 13. Deployment

Final HEAD/API/Web: `5e89cd7c853611202ba865b20ba4aa0ece4823d6` (CONSISTENT). Initial feature commit `98858591fe9107d4de628b43c7982f1699e91121`; E2E recording fix `2abf76c537cf5e793832fb806ccbc7c7b32d8190`; working-cache fix `8ee5c4fae729d54e34737d992e9fc154638de489`; TipTap autosave fix is the final SHA. None was pushed.

Initial migration/deployment commands remain as recorded in section12. Each follow-up used `./scripts/backup.sh`, `./scripts/deploy.sh all`, `./scripts/healthcheck.sh` and `./scripts/deploy.sh check`. No additional migration, seed, API or dependency change was introduced by the follow-up. Both services were synchronized because the runbook requires HEAD/API/Web identity; PostgreSQL was not recreated.

Web/API/PostgreSQL healthy; Web, API, Swagger and OpenAPI checks passed. All30 Knowledge routes remain; old articles/categories404 and anonymous/private static probes remain as recorded in `KNOWLEDGE_2_LIVE.json`. Actual existing restricted Page and private attachment return401 without authentication; authorized historical file downloads return200/nonempty.

Administrator acceptance created only clearly marked synthetic pages/files through Application APIs, then purged each recorded test subtree and ran cleanup. Final read-only checks: HR ACTIVE; Pages0, versions0, attachments0, cleanup tasks0 and private Knowledge objects0. Metadata audit records are retained; no business pages were seeded or modified.

PostgreSQL remains `b679ba44dd7507ac797759ed41acdc77f1757f5fcf9bec2f0918565352583c44`, original mount `/data/automation/code/work/PMC/knweb/data/postgres -> /var/lib/postgresql`, healthy. Host bind remains `127.0.0.1:15433 -> 5432`; API still uses `postgres:5432`. The previously verified steel history through2026-09-30 remains1078 records/1078 unique IDs/13 series/98 days,2026-05-06 through2026-09-30. Current full table has1089 records/99 days because it also contains11 rows dated2026-10-08; this Knowledge task did not write the intelligence schema. No smart-stock/steel_price/MariaDB/environment/PostgreSQL configuration or account permissions/passwords were changed in this follow-up.

Evidence: `KNOWLEDGE_2_LIVE.json`, `KNOWLEDGE_2_DATABASE_VALIDATION.json`, `KNOWLEDGE_2_ADMIN_ACCEPTANCE.json`.

## 14. Production acceptance

User explicitly directed administrator-only acceptance. All23 in-scope production Chrome checks PASS; two employee-specific checks are excluded, not silently treated as passed. Cases16-18 verify administrator configuration/inheritance and anonymous rejection; they do not demonstrate denial to another authenticated employee account. Employee tree/search/direct URL/history/file/breadcrumb isolation remains covered by isolated automated tests, and was not exercised with a live employee account this round. No account grants/passwords were changed to make tests pass.

| # | Check | Actual production result |
|---|---|---|
| 1 | Enter Knowledge from Portal | PASS: Authenticated production Portal -> Knowledge |
| 2 | HR Space visible | PASS: HR ACTIVE visible in real UI and authorized API |
| 3 | Create Page | PASS: Production UI new Page command |
| 4 | Page immediately persisted | PASS: Persistent UUID/pageId and DRAFT returned before manual save |
| 5 | Upload image without manual save | PASS: Actual immediate PNG upload without manual draft save |
| 6 | Upload attachment without manual save | PASS: Actual immediate TXT upload without manual draft save |
| 7 | Autosave succeeds | PASS: 1200ms debounced title/body persisted through actual PATCH |
| 8 | Create child Page | PASS: Actual UI creates child with correct parent |
| 9 | Multilevel tree | PASS: Three-level real Page hierarchy and lazy sidebar tree |
| 10 | Publish V1 | PASS: Publish V1 via production UI; default read reports version1 |
| 11 | Employee reads V1 | NOT EXECUTED: excluded by explicit administrator-only scope |
| 12 | Administrator edits working draft | PASS: Admin edits working body; actual default published API retains V1 |
| 13 | Employee still reads old V1 | NOT EXECUTED: excluded by explicit administrator-only scope |
| 14 | Publish V2 | PASS: Production UI publishes V2 |
| 15 | V1 history/files retained | PASS: Actual V1 history UI/API and its two file snapshots remain intact; authenticated version downloads return200/nonempty |
| 16 | Page ACL inheritance | PASS: Admin UI restricts parent; child retains inherited ACL configuration (non-admin effective denial outside scope) |
| 17 | Private Page protected | PASS: Actual existing private Page direct API denied to anonymous; other employee accounts outside scope |
| 18 | Private attachment protected | PASS: Actual existing private image denied401 without authentication |
| 19 | DOCX import | PASS: Actual docx preview UI -> commit command -> persisted draft; manual publication required |
| 20 | Markdown import | PASS: Actual md preview UI -> commit command -> persisted draft; manual publication required |
| 21 | HTML import | PASS: Actual html preview UI -> commit command -> persisted draft; manual publication required |
| 22 | Chinese search | PASS: Real UI search and ACL-filtered published API return test hierarchy; Chinese 请假 query also matched the test page |
| 23 | Breadcrumb | PASS: Live breadcrumb includes authorized Space/parent/child titles |
| 24 | Archive/restore | PASS: Archive subtree and restore through actual archive UI without replacing versions |
| 25 | Trash/restore | PASS: Actual trash UI restores subtree with existing published versions |

All temporary roots, children, version snapshots and files were removed through authorized API commands; final counts are zero. The report records no credential values. Initial failed runs also cleaned their own recorded trees. A runner synchronization issue during Trash was corrected to await the actual DELETE/restore response before querying a status-specific read; no Trash product change was required.

Manual repeat (administrator): Portal -> Knowledge -> HR -> create a clearly marked Page -> upload PNG/TXT before manual save -> edit title/body and await 已保存 -> create child/grandchild -> publishV1 -> edit working draft while default published read retainsV1 -> publishV2 -> read/download V1 history -> configure only that test Page's ACL -> search 请假 and inspect breadcrumb -> archive/restore -> trash/restore. Preview DOCX/MD/HTML and commit as drafts. Finally permanently delete only the marked test roots. Employee acceptance can be run later with an existing authorized employee account without changing grants; it is outside this round's scope.

## 15. Unfinished items and limits

No unfinished items within the user-directed administrator scope. Administrator production acceptance, fixes, tests, backups, deployment, health and temporary-data cleanup are complete. Employee live-account checks11/13 and effective ACL behavior with another authenticated account were excluded by user direction; they are not declared production PASS. Optional DOCX/PDF export, Excel content import, diff, drag-and-drop ordering, exact Office layout and external-image fetching are outside the delivered scope. Unsaved failed drafts survive in-session navigation only, not browser termination. Other task records (equipment/PMC) remain unchanged.

Record/evidence files: `outputs/CODEX_PROGRESS.md`, `outputs/KNOWLEDGE_2_ACCEPTANCE.md`, `outputs/KNOWLEDGE_2_BACKUP_SHA256.txt`, `outputs/KNOWLEDGE_2_DATABASE_VALIDATION.json`, `outputs/KNOWLEDGE_2_LIVE.json`, `outputs/KNOWLEDGE_2_ADMIN_ACCEPTANCE.json`.

Changed source files (51, including the retired categories screen):

- `ARCHITECTURE.md`
- `SECURITY.md`
- `apps/api/package.json`
- `apps/api/src/common/filtering/table-filter-registry.spec.ts`
- `apps/api/src/migrations/1722920085000-Knowledge2SpacePageModel.ts`
- `apps/api/src/modules/knowledge/knowledge.application.service.ts`
- `apps/api/src/modules/knowledge/knowledge.content.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.content.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.ts`
- `apps/api/src/modules/knowledge/knowledge.database-validation.ts`
- `apps/api/src/modules/knowledge/knowledge.document.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.document.ts`
- `apps/api/src/modules/knowledge/knowledge.export.service.ts`
- `apps/api/src/modules/knowledge/knowledge.file.ts`
- `apps/api/src/modules/knowledge/knowledge.filter-sources.ts`
- `apps/api/src/modules/knowledge/knowledge.import.service.ts`
- `apps/api/src/modules/knowledge/knowledge.import.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.module.ts`
- `apps/api/src/modules/knowledge/knowledge.query.service.ts`
- `apps/api/src/modules/knowledge/knowledge.scope.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.scope.ts`
- `apps/api/src/modules/knowledge/knowledge.test-documents.ts`
- `apps/api/src/modules/knowledge/knowledge.types.ts`
- `apps/api/src/storage/local-object-storage.spec.ts`
- `apps/api/src/storage/local-object-storage.ts`
- `apps/api/src/storage/object-storage.ts`
- `apps/web/e2e/knowledge-ui.spec.ts`
- `apps/web/package.json`
- `apps/web/src/App.tsx`
- `apps/web/src/modules/knowledge/KnowledgeAccess.tsx`
- `apps/web/src/modules/knowledge/KnowledgeCategories.tsx`
- `apps/web/src/modules/knowledge/KnowledgeContent.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeContent.tsx`
- `apps/web/src/modules/knowledge/KnowledgeEditor.tsx`
- `apps/web/src/modules/knowledge/KnowledgeImport.tsx`
- `apps/web/src/modules/knowledge/KnowledgePageSelect.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.tsx`
- `apps/web/src/modules/knowledge/KnowledgeSettings.tsx`
- `apps/web/src/modules/knowledge/knowledge-autosave.spec.ts`
- `apps/web/src/modules/knowledge/knowledge-autosave.ts`
- `apps/web/src/modules/knowledge/knowledge-ui.ts`
- `apps/web/src/modules/knowledge/knowledge.css`
- `apps/web/src/modules/portal/ModulePortal.tsx`
- `docs/integration-guide.md`
- `docs/knowledge-base.md`
- `docs/runbook.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/knowledge.ts`
- `pnpm-lock.yaml`
- `scripts/validate-knowledge.mjs`


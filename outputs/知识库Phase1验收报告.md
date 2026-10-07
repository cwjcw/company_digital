# 知识库 Phase 1 验收报告

## 交付状态

源码、迁移与正式部署已完成。Repository / Web / API 均为 `8ca93306f76619f2fc22a897ca9cc87d8632cbd0`。系统健康检查和线上公开入口/安全核验通过；生产管理员与员工登录态业务验收仍待现有测试账号，不能将其表述为已全部验收。

访问：[知识库](http://192.168.1.249:15172/knowledge)。

本次实现独立 knowledge 模块与 `/knowledge`，复用现有身份、组织、表权限组、公共表格、筛选/导出、审计与对象存储。没有开发新的 HR、人事、招聘、AI/RAG 或基础设施。

用户附件实际收到的末尾是第85节第10项“普”的不完整文字；未把这段缺失内容当作已知验收要求。

## 数据库与依赖

新增唯一 TypeORM migration：`1722920084000-KnowledgeBasePhaseOne.ts`，跟随正式实际使用的兼容主库 `four_department_tracker`，不在 kdos 复制第二套表，不修改已应用迁移，不运行 seed。

新增7张知识表：categories、articles、tags、article_tags、attachments、article_versions、version_attachments（均以 knowledge_ 为前缀）。全部 UUIDv7、tenant、标准创建/更新审计、version；复合 tenant 外键、唯一约束、二层分类约束、RLS、不可变发布快照触发器、pg_trgm 和 GIN 索引。

仅幂等初始化 `HR / 人力资源` 一级分类。没有迁移或CLI创建任何正式二级分类，二级分类由获权人员从前端手工创建。

新增 Web npm 依赖3项：`@tiptap/core`、`@tiptap/react`、`@tiptap/starter-kit`，package.json 为 ^3.31.4，lockfile 实际 3.31.4。API 无新增依赖，图片处理复用 Sharp。

## 业务与安全实现

- 工作副本独立于不可变发布快照。保存草稿不改变员工当前正文、标题、标签、搜索、ACL 或附件；首次发布v1，重新发布只追加版本。
- 状态 DRAFT/PUBLISHED/DISABLED。发布/停用复用 update 与字段权限，无新增 publish 权限动作；expectedVersion 冲突409。
- 统一服务端 tenant + 操作 + 字段 + 数据范围 + 状态 + ACL，覆盖列表、搜索、详情、历史、文件、候选和平台导出。其他模块管理员不能获得知识权限。
- ALL/ORGANIZATION/ROLE/USER 使用稳定ID；组织覆盖完整子树，角色成员复用即时组织归属。撤权后后端立即拒绝。
- 非管理员历史访问同时受当前发布完整授权与历史ACL限制；停用文章对员工隐藏。
- 正文为可信JSON，严格节点/属性/marks/结构白名单；plain text/hash由服务器生成。无HTML注入、远程图片、事件属性或脚本链接。
- 附件使用 ObjectStorage 私有扩展，uploads/.private 无公共URL，API与Nginx均拒绝静态访问；认证下载检查文章/版本关系，no-store/nosniff。
- 上传图片由 Sharp 验证、重编码和像素限制；数据库/审计失败补偿删除新文件。工作副本移除文件保留历史引用。
- 审计记录tenant、操作人、版本、变更字段、附件元数据/hash，不保存整篇正文。
- 管理表复用 KdosDataTable、SqlFilterCompiler、权限管理和统一导出；默认100分页，导出全部匹配数据，并取read/export范围交集。
- 中文正文与标签搜索直接命中 search_text trigram GIN；隔离库自然planner EXPLAIN验证“绩效考核”和短词“请假”。

## API

统一 `/api/v1/knowledge`，17个HTTP操作全部 AuthGuard：

| 方法 | 路径 |
|---|---|
| GET / POST | /categories |
| PATCH / DELETE | /categories/:id |
| GET | /options |
| GET / POST | /articles |
| GET / PATCH / DELETE | /articles/:id |
| POST | /articles/:id/publish |
| POST | /articles/:id/disable |
| GET | /articles/:id/versions |
| GET | /articles/:id/versions/:number |
| POST | /articles/:id/attachments |
| DELETE | /articles/:id/attachments/:attachmentId |
| GET | /attachments/:id |

标准管理筛选/候选/导出继续使用现有平台路由。详见 docs/knowledge-base.md。

## 自动化与构建

| 检查 | 结果 |
|---|---|
| API全量Jest | 87 suites通过；733通过、1既有跳过 |
| Web全量Vitest | 30文件/206项通过，单worker、testTimeout15000 |
| Web知识库定向 | 21项通过，包含失败保留草稿最新version |
| 其他workspace测试 | 全部通过，Contracts22、Permissions1等 |
| 真实PostgreSQL知识库 | 52项通过；RLS、tenant、四类ACL、字段/范围、动态撤权、快照、附件、审计回滚、并发409、GIN |
| 跨页导出 | 页面100条，筛选total4000，标准导出4000条 |
| 真实Chrome知识交互 | 3通过/1现有账号登录项跳过；接口拦截夹具，不是生产登录验收 |
| 全workspace typecheck | 通过 |
| 全workspace lint | 0错误，1既有Portal Fast Refresh警告 |
| 全workspace build | 通过；本机Node22与项目Node24要求的既有提示、既有大bundle提示保留 |
| 新API镜像Sharp | 预检与最终Node24镜像PNG处理均通过（92 bytes），无主机运行库挂载 |

初次完整Web默认5秒下，两个既有设备DOM测试超时；最终完整回归扩大运行超时后206项全部通过，无无关测试修改。测试库 `knowledge_test_phase1_20261007` 已删除，性能数据未写入正式库。验证日志仅在私有忽略目录 `data/knowledge-validation/`，不提交业务文件或凭据。

## 修改文件清单

- `ARCHITECTURE.md`
- `SECURITY.md`
- `apps/api/src/app.module.ts`
- `apps/api/src/auth.spec.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/common/filtering/table-filter-registry.spec.ts`
- `apps/api/src/common/filtering/table-filter.controller.ts`
- `apps/api/src/common/filtering/table-filter.registry.ts`
- `apps/api/src/common/printing/table-print.service.ts`
- `apps/api/src/main.ts`
- `apps/api/src/migrations/1722920084000-KnowledgeBasePhaseOne.ts`
- `apps/api/src/modules/knowledge/knowledge.application.service.ts`
- `apps/api/src/modules/knowledge/knowledge.content.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.content.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.ts`
- `apps/api/src/modules/knowledge/knowledge.database-validation.ts`
- `apps/api/src/modules/knowledge/knowledge.filter-sources.ts`
- `apps/api/src/modules/knowledge/knowledge.module.ts`
- `apps/api/src/modules/knowledge/knowledge.query.service.ts`
- `apps/api/src/modules/knowledge/knowledge.scope.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.scope.ts`
- `apps/api/src/modules/knowledge/knowledge.types.ts`
- `apps/api/src/storage/local-object-storage.spec.ts`
- `apps/api/src/storage/local-object-storage.ts`
- `apps/api/src/storage/object-storage.ts`
- `apps/web/e2e/knowledge-ui.spec.ts`
- `apps/web/nginx.conf`
- `apps/web/package.json`
- `apps/web/src/App.tsx`
- `apps/web/src/modules/knowledge/KnowledgeCategories.tsx`
- `apps/web/src/modules/knowledge/KnowledgeContent.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeContent.tsx`
- `apps/web/src/modules/knowledge/KnowledgeEditor.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.tsx`
- `apps/web/src/modules/knowledge/knowledge-ui.ts`
- `apps/web/src/modules/knowledge/knowledge.css`
- `apps/web/src/modules/portal/ModulePortal.tsx`
- `docs/integration-guide.md`
- `docs/knowledge-base.md`
- `docs/runbook.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/knowledge.ts`
- `pnpm-lock.yaml`

另持续更新 `outputs/CODEX_PROGRESS.md` 并新增本验收报告；此前任务outputs保持原样。

## 正式备份、迁移、部署与线上检查

执行时间：2026-10-07 14:09–14:12（Asia/Shanghai）。

1. 正式 Node24 API/Web 镜像构建通过；最终镜像 Sharp 实际PNG处理通过。
2. `scripts/migrate.sh` 先运行标准备份（双库可读的 pg_restore --list 与 uploads），再执行唯一待迁移084；无seed。备份SHA256重新校验全部OK。
3. `scripts/deploy.sh all` 成功，Repository/Web/API SHA完全一致 `8ca9330`。
4. `scripts/healthcheck.sh` 通过：PostgreSQL、API、Web、Swagger、OpenAPI、首页正常；局域网入口 `192.168.1.249:15172` 健康返回同一SHA。
5. 生产只读schema核验：7表、7 RLS策略、7表标准审计列、2 GIN索引、2不可变trigger、pg_trgm与迁移账本存在。唯一HR根分类UUIDv7；0二级分类/0文章/0附件，未注入业务测试数据。
6. 线上26项检查通过：17个Knowledge HTTP操作匿名401，标准导出匿名401，私有路径（含编码）404，SPA路由200，编译产物含Portal入口与知识路由，OpenAPI12个路径/17操作。
7. 实际 ObjectStorage 私有canary写入/读取成功且无public URL；直连API和Nginx各自的普通/编码静态路径均404。finally删除canary并确认不存在，不改文章数据。
8. 针对部署后真实静态资产再跑Chrome：3通过/1现有账号项跳过。夹具全量拦截API；管理员分类创建、TipTap保存/附件/发布以及普通员工按钮交互验证通过，但未冒充真实生产登录验收。
9. 仅清理本任务创建的隔离数据库；正式库、用户、权限、旧数据和历史outputs保持。

备份文件与SHA256（在忽略且受限的data/backups目录，不纳入Git）：

```text
e430ba097a2f6f1033ae5ccd7a5091be5fa7264ac120286a1f036a5fb7b9f03a  data/backups/four_department_tracker_20261007_140954.backup
d8cc57fac5f0280fcf050dbcb7bebbd53b6b33b29aee5767e2c9098661a8f7f3  data/backups/kdos_20261007_140954.backup
089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533  data/backups/uploads_20261007_140954.tar.gz
```

可恢复验证证据：`data/knowledge-validation/migration-final.log`、`deploy-final.log`、`health-final.log`、`production-schema-final.json`、`online-final.json`、`storage-online-final.log`、`browser-deployed-final.log`、`database-final.json`、`workspace-test-final.log`、`web-full-final.log`。这些文件包含本机验收结果，留在忽略目录。

## 人工验收步骤

1. 用现有知识库管理员登录首页，确认独立“知识库 / KNOWLEDGE BASE”入口进入 `/knowledge`；初始只显示“人力资源”一级分类。
2. 通过前端新增二级分类，再改名/排序/启停；重复同父名称和第三层分类应被拒绝。
3. 进入文章管理，为标题、摘要、分类、标签、富文本、ACL录入内容，保存草稿；员工列表不应看到草稿。
4. 在已保存草稿上传TXT/PDF/Office/图片，插入已上传图片；检查受控下载，未授权账号或直接静态路径不能获取文件。
5. 发布v1，用获权员工确认正文、搜索、标签、分类、附件；无授权员工无法通过猜ID读取详情、版本或附件。
6. 修改工作副本标题/正文/标签/ACL/附件，仅保存。员工仍看到v1；重新发布后看到v2，历史v1内容和附件保持原样。
7. 分别验证ALL、组织子树、普通角色、指定成员ACL；调离组织或撤角色后立即拒绝。表字段与数据范围需同时生效。
8. 管理表按正文中文、分类、标签与高级筛选查询；切换分页，导出检查全部匹配记录，字段与姓名/分类显示值一致。
9. 两窗口使用同一version提交，后一窗口应409并保留输入；模拟发布失败应提示“草稿已保存、发布失败”，重试使用已提交最新version。
10. 停用已发布文章，员工列表/搜索/正文/附件隐藏，管理员历史仍可查。纯草稿可删除，发布过文章禁止删除。
11. 权限管理页分别配置 knowledge-categories 与 knowledge-articles；普通员工无创建按钮且直接API写入被拒绝，明确授权编辑者可按字段/范围执行。

## 真实限制与恢复

尚未提供现有管理员/员工测试凭据，不能执行生产登录态的手工分类创建、草稿保存、附件上传、发布与员工阅读。不会伪造JWT、重置生产账号或修改生产权限用于验收。获得现有账号后按以上步骤继续，测试记录将补入本报告。

## 后续边界

已保留可信JSON/plain text/hash、稳定分类/标签、版本及附件元数据，可用于未来明确授权的检索集成。本阶段没有embedding、向量库、RAG队列或AI写入。

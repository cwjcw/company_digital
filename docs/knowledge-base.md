# Knowledge Base Phase 1

知识库是独立 `knowledge` 模块，canonical 首页 `/knowledge`。它复用现有本地 JWT/API Key、实时管理员与表权限声明、稳定用户/组织/普通角色 ID、组织成员 helper、公共表格/筛选/导出、AuditLog 和 ObjectStorage；不新增 HR、人事系统、身份体系、AI 或 RAG 服务。

## 数据库与分类

正式运行的设备、督办、研发等新兼容模块仍使用 TypeORM 主连接 `four_department_tracker`；知识库跟随这条实际边界，不将相同表再复制到 `kdos`。新增 migration `KnowledgeBasePhaseOne1722920084000` 创建 pg_trgm 和 7 张表：`knowledge_categories`、`knowledge_articles`、`knowledge_tags`、`knowledge_article_tags`、`knowledge_attachments`、`knowledge_article_versions`、`knowledge_version_attachments`。全部具有UUIDv7主键、tenant及标准创建/更新审计和version字段，启用 tenant RLS，查询仍显式 tenant 条件，事务设置 `app.tenant_id`。

仅初始化当前默认租户唯一一级分类 `HR / 人力资源`，UUIDv7 + tenant/code 防重复。没有预置二级分类；管理员从前端手工创建，最多两层，同父分类名称唯一。启停、排序、重命名使用 expectedVersion；已引用分类及一级分类不能删除。

## 工作副本与发布

`knowledge_articles` 保存可编辑工作副本，`working_revision` 与并发 `version` 分开。状态只有 DRAFT / PUBLISHED / DISABLED。发布由现有 update 权限执行，要求 status 字段可编辑、发布所需字段可读及合法正文/分类/ACL/附件。没有新增 publish 权限动作。

首次发布写入 v1；重新发布追加 v2、v3，不更新历史版本。数据库 trigger 拒绝修改或删除已发布正文快照和版本附件关系。快照保留可信 JSON、服务器提取 plain text、SHA256、分类名称、标签、ACL、发布时间/人和附件集合。保存工作副本不改变员工当前发布版本的标题、正文、搜索、标签、ACL 或文件。历史分类名称来自发布快照。

从未发布的草稿可逻辑删除；文章 tombstone 与文件 metadata 保留私有所有权和审计，所有读取/下载入口拒绝访问。已发布过文章只能停用。工作副本移除附件不删除历史版本文件；未来清理只能按明确保留政策执行，不能直接删除历史引用。

## 授权

两资源 `knowledge-categories` / `knowledge-articles` 注册现有 contracts 与表权限管理页。分类树复用公共权限按钮；文章管理使用 KdosDataTable。系统/知识库模块管理员仅按既有 claims 授权，其他模块管理员不获得知识权限；普通角色不冒充管理员。

服务端 `KnowledgeAccessService` 统一构造 tenant、表操作、数据范围、状态与 ACL 条件，列表、正文、搜索、历史、文件、平台候选/导出复用。ALL 仍要求表 read；ORGANIZATION 使用稳定组织 ID、完整子树及现有 `createOrganizationMembershipIndex`，ROLE 解析实时直接/部门角色，USER 使用稳定用户 ID。字段按 read 裁剪，搜索需标题/摘要/正文纯文本/标签全部可读。导出叠加 read 与 export 的数据范围。平台文章源是管理视图，普通只读员工不能通过通用表格入口读取工作副本。

非管理员历史访问同时要求当前发布文章完整授权与该历史版本 ACL。停用后的历史仅管理员可读取。受控文件先查文章及版本关系，再读 ObjectStorage；猜文件 ID 不足以下载。

## 正文与私有文件

前端 TipTap JSON 编辑器和 React allowlist 阅读器；不接受 HTML，不使用 dangerouslySetInnerHTML。后端严格限制节点、结构、属性与 marks，只允许 http/https/mailto 链接，拒绝 script/iframe、事件属性、客户端 contentText 和远程图片。服务器生成可信 plain text/hash；图片节点只引用本文章已上传且有效的附件 UUID。

现有 LocalObjectStorage 扩展可选 `visibility=private`，知识文件保存到 uploads/.private，返回 key 给服务内部、不给公共 URL。API 静态层与 Nginx 拒绝该路径。原有 public 行为保留。浏览器通过认证 API 拉取 Blob，图片 Object URL 在切换/卸载时释放；敏感文件响应 no-store/nosniff。上传最多20个、每个20MB，允许 Office/PDF/TXT/PNG/JPEG/WebP，拒绝不符格式；图片由既有 Sharp 解码重编码、像素限制40M。存储写入后数据库失败会补偿删除新对象。

## 搜索、筛选与导出

工作副本和发布快照各有 `search_text` trigram GIN 索引，内容为标题+摘要+服务器可信正文纯文本+标签。查询直接 `search_text ILIKE $n` 匹配索引；列表、管理表、筛选候选及标准导出共用 `knowledgeSearchClause`。标准字段使用唯一 SqlFilterCompiler，不另建解析器。中文请假、绩效考核、标签搜索与自然 planner GIN EXPLAIN 在隔离库测试。

服务端分页默认100，可选50/100/200/500/1000。前端使用项目统一5分钟查询缓存及写后失效，退出/权限变化沿用全局缓存清除。标准管理表导出通过既有 `/table-exports/knowledge-articles` 跨页取全部匹配记录，分类 label 批量按 actor tenant 解析。该公共导出仍沿用现有平台的单元格文本格式，不另建知识库 Excel 框架。

## API

统一前缀 `/api/v1/knowledge`，全部 AuthGuard：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET/POST | /categories | 分类读取/手工新增二级分类 |
| PATCH/DELETE | /categories/:id | 并发修改/删除未使用二级分类 |
| GET | /options | 编辑器稳定用户/组织/普通角色选项 |
| GET/POST | /articles | 授权分页搜索/创建草稿 |
| GET/PATCH/DELETE | /articles/:id | 发布阅读或 mode=manage / 工作副本修改 / 删除纯草稿 |
| POST | /articles/:id/publish | 首次或重新发布 |
| POST | /articles/:id/disable | 停用 |
| GET | /articles/:id/versions | 授权历史版本列表 |
| GET | /articles/:id/versions/:number | 不可变历史正文 |
| POST | /articles/:id/attachments | multipart file + expectedVersion |
| DELETE | /articles/:id/attachments/:attachmentId | 从工作副本移除 |
| GET | /attachments/:id | 受控文件；mode=manage 或 version=N |

所有写入使用 Application Service，审计仅存 tenant、元数据、版本、hash、变更字段与附件信息，不保存整篇正文。编辑/发布/停用/移除文件必须传 expectedVersion，冲突409，不能盲目增加版本重试。

## 验证与上线

先跑相关 Jest / Vitest、全量回归、typecheck/lint/build，再标准双库/uploads备份、核验 SHA256。只新增本迁移，不改旧迁移、不执行 seed。使用 scripts/migrate.sh 和 scripts/deploy.sh all，要求 Repository/Web/API SHA 一致、健康检查及线上路由验证。

`knowledge.database-validation.ts` 是真实 PostgreSQL 自动验收入口，仅接受名称前缀 knowledge_test_ 的隔离空数据库，绝不运行在正式库；覆盖发布、ACL、权限字段/范围、历史附件、并发、审计、RLS 与 EXPLAIN。其文件对象替身用于验证业务边界；LocalObjectStorage 单元测试及新镜像 Sharp 运行检查补充存储/图片实际能力。

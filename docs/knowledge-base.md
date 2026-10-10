# KDOS Knowledge 2.0

知识库是现有 `knowledge` 模块，入口 `/knowledge`。Space 是业务与权限边界，Page 是唯一内容节点；标题页、目录页、正文页和带附件的页面都使用同一模型，支持任意深度父子树。Phase 1 的 Category/Article 模型、路由、前端及权限资源已撤销，不提供两套正式业务契约。

## 数据与发布

沿用实际兼容边界 TypeORM / `four_department_tracker.public`，不复制到 KDOS 库。历史 `1722920084000-KnowledgeBasePhaseOne` 保持原样；新增 `1722920085000-Knowledge2SpacePageModel` 撤销旧7表，建立 Space、Space access、Page、Page access、Page versions、Attachments、Version attachments、Tags、Page tags、Storage cleanup 共10表及 `knowledge_page_read_model` 发布只读视图。

全部表具备 UUIDv7、tenant、标准审计字段和 version，并启用 `app.tenant_id` RLS；SQL 同时显式过滤 tenant。默认仅幂等初始化稳定 code=HR 的人力资源 Space，不初始化业务页面或默认权限组。同空间父节点复合外键、循环触发器、Application 校验和 tenant 树事务锁共同保护树。跨空间移动检查整个子树与目标权限。

新建立即保存 DRAFT 并返回 pageId，可以直接上传。工作副本保存规范 JSON / 可信纯文本 / SHA256；发布才追加不可变版本及附件快照，员工读取当前发布版本。历史记录及历史附件关系禁止更新/普通删除，旧版本也不能追加新附件。永久删除仅在已授权的回收站子树命令内解除引用并删除。审计保留动作、ID、计数、字段名和 hash，不存完整正文。

DRAFT、PUBLISHED、ARCHIVED、TRASHED 分开。归档子树保留阅读和历史，在已归档页面入口查阅；恢复归档沿用原发布版本。回收站恢复按删除批次恢复，之前单独删除的子页面不会误恢复。永久删除清理子树、版本、标签关系、ACL 与文件；存储清理失败保留 tenant 隔离任务，每分钟重试默认tenant，也可调用附件清理命令重试自己已授权的任务。Space 删除接口执行归档，保留页面和历史。默认租户管理员清理任务还通过现有 ObjectStorage 的私有前缀枚举，核对文件和数据库引用，回收事务提交前进程中断遗留的孤儿对象；枚举与上传共用租户事务锁，其他租户和仍被引用的文件不受影响。

## 权限

资源为 `knowledge-spaces`、`knowledge-pages`；旧两个资源从平台注册和权限声明撤销，旧 Knowledge 专属权限组停用，用户、普通角色及其他模块权限保留。管理员使用现有表权限管理页配置新资源，不自动给普通用户扩权。发布/归档/恢复沿用 update，回收站/永久删除沿用 delete；不新增全局 publish/archive 动作。

`KnowledgeAuthorizationService` 统一树、列表、正文、搜索、版本、附件、导入提交、导出和平台候选值的 SQL 边界：tenant + 表动作 + 字段权限 + 数据范围 + Space grant + 每一层祖先限制 + 状态。Space grant 使用稳定 USER/ROLE/ORGANIZATION/ALL 和 VIEWER/EDITOR/FULL_ACCESS；Page 限制逐层取交集，子节点不能扩大空间或上级授权。组织及普通角色从平台实时成员关系解析。系统/Knowledge 管理员沿用平台管理员能力，其他模块管理员无 Knowledge 提权，管理员仍受 tenant 限制。

只读角色不能请求工作副本。历史查看额外与当时的权限成员快照取交集，并继续检查当前页面和祖先权限。正文、纯文本、标签、附件和路径按平台字段权限裁剪；搜索不可使用隐藏正文或祖先字段作为侧信道。导航可切换已发布/工作页面，较窄只读授权仍可在已发布树阅读。平台行/筛选候选/标准 Excel 导出只访问发布视图，不暴露未发布的工作副本。

## 搜索与文件

`published_search_text` 是当前发布内容的搜索投影，包含发布标题、可信正文纯文本、发布标签、当前空间和上级发布标题。发布/上级发布/移动/空间改名用同一事务刷新受影响投影，不修改不可变版本，也不包含工作副本文字。PostgreSQL pg_trgm GIN 索引 `idx_knowledge_pages_search` 支持参数化 ILIKE；先执行 tenant/ACL/数据范围/筛选，再计数、相关度排序和分页。使用平台唯一 SqlFilterCompiler 处理 FilterGroup。路径显示当前已授权祖先，避免移动后显示旧私密路径。

文件复用 ObjectStorage private，位于 uploads/.private，继续由 API 和 Nginx 拒绝静态访问；只经认证 Knowledge 下载接口返回，no-store/nosniff。图片经 Sharp 真实解析/重编码；名称移除路径和控制字符；Office 校验真实类型并对 ZIP 目录和实际解压流限制大小。正文只接受严格 JSON allowlist，React 安全渲染；HTML 导入先 sanitize 再转规范 JSON，无脚本、危险 URL 或事件属性。

## 自动保存与导入导出

前端 1200ms 防抖，单队列串行保存/上传/发布，expectedVersion 409 不覆盖、不自动重试，保留本地输入；普通失败可以重试，显示等待/保存中/已保存/失败/冲突。发布前及本模块跳转前 flush，浏览器关闭有未保存提示；跨模块离开后的失败草稿仅保存在当前账号/权限范围的内存中，返回编辑器可恢复，退出登录先flush，清理后不跨账号复用。新建不存在“先手动保存才能上传”的步骤。内容编辑器复用 TipTap，包含 H1/H2/H3、基础标记、列表、引用、提示块、链接、表格、代码、私有图片、分割线、撤销/重做及粘贴图片上传。

DOCX、Markdown、HTML：预览 → 选择空间/父页面/标签/继承或限制权限 → 提交为 DRAFT → 人工发布。DOCX 用 Mammoth 保留标题、常规粗斜体、列表、表格、链接和 PNG/JPEG/WebP 内嵌图；Markdown 支持 GFM 表格、代码和链接；HTML 清洗后转结构化正文。预览 token 绑定用户及tenant，有效10分钟，限内存容量且提交后消耗，重启需重新预览。上传解析前统一调用加密检测，原样提示“该文件被加密,请解密后再导入.”。

限制：源文档20MB；转换正文2MB，规范正文500KB/10000节点；Office单项解压30MB、总100MB、最多2000项；页面最多20个附件，预览内嵌图最多20张；不保留 DOCX 页眉页脚、分页、浮动排版、字体精确版式或 HTML CSS。外部/相对图片不下载（避免SSRF），提示导入后手动上传；仅支持 PNG/JPEG/WebP 图片。不提供 Excel 内容导入。

单页导出 Markdown / HTML，使用同一授权查询并内嵌当前已授权图片，无私有 storage key 或公共URL。非图片附件经页面认证下载单独获取。DOCX/PDF 导出不在本轮实现。标准平台 Excel 导出复用已有 TablePrintService，导出全部当前筛选后的发布页面，不是当前分页。

## API

统一前缀 `/api/v1/knowledge`，所有接口 AuthGuard：

|方法|路径|作用|
|---|---|---|
|GET / POST|`/spaces`|可见空间 / 新建|
|PATCH / DELETE|`/spaces/:id`|修改（包括归档/恢复）/ 归档保留|
|GET / PATCH|`/spaces/:id/access`|完全管理者查询 / 配置成员|
|GET|`/spaces/:id/tree`|当前空间的根/子节点，服务端分页|
|GET|`/pages` / `/search`|列表/已发布搜索，FilterGroup|
|POST|`/pages`|立即创建草稿|
|GET / PATCH / DELETE|`/pages/:id`|正文 / 自动保存 / 移入回收站|
|PATCH|`/pages/:id/access`|限制或继承|
|POST|`/pages/:id/move`|移动/排序|
|POST|`/pages/:id/publish`|发布新版本|
|POST|`/pages/:id/archive` / `/unarchive`|归档 / 恢复归档|
|POST|`/pages/:id/restore`|回收站恢复|
|DELETE|`/pages/:id/permanent`|永久删除已授权子树|
|GET|`/pages/:id/versions` / `/versions/:versionId`|版本列表 / 版本正文|
|POST|`/pages/:id/attachments`|立即私有上传|
|GET / DELETE|`/attachments/:id`|认证下载 / 工作副本解绑|
|POST|`/attachments/cleanup`|清理未被版本引用的已解绑文件/重试|
|POST|`/imports/preview` / `/imports/commit`|解析预览 / 新草稿提交|
|GET|`/pages/:id/export?format=md（或html）`|单页导出|
|GET|`/options`|有权限配置字段授权的编辑者获取现有平台成员选项|

读取默认 mode=published；working 必须有平台 update 及有效 EDITOR，trash 必须 FULL_ACCESS；versionId 指定不可变历史UUID。所有已有记录写入必须 expectedVersion。

## 验证与上线

`pnpm --filter @tracker/api build` 后运行 `node scripts/validate-knowledge.mjs`，只创建、使用、删除 `knowledge_test_*` 隔离数据库；验证旧→新模型、全部历史迁移重放、真实 RLS/树/ACL/发布/附件/导入/搜索/审计及 EXPLAIN。报告 `outputs/KNOWLEDGE_2_DATABASE_VALIDATION.json`。API/Web 单测及 Chrome 场景见 Knowledge 测试文件；生产账号验收只接受本轮授权的运行时凭据，禁止临时JWT、生产密码/权限改动或复用仅授权PMC Phase5的凭据。

上线按标准双库+uploads备份/SHA256 → 新API镜像migration → deploy all → healthcheck，源码HEAD、API和Web版本应一致。执行过的历史 migration 不修改，自动回退新 migration 被明确禁止，应按已校验的升级前备份恢复。人工检查清单及真实结果在 `outputs/KNOWLEDGE_2_ACCEPTANCE.md`，未实际验收的项目不得标为PASS。

## Knowledge 2.1 创建体验

“新建知识”集中在线编写、上传原始文件、从DOCX/Markdown/HTML导入在线文章；上传与导入保持独立服务。创建前统一显示保存位置，点击“更改位置”才展开Space与懒加载页面树。默认采用当前Space/页面，空间根目录明确显示，移动目标排除本页及后代。`GET /api/v1/knowledge/spaces/:id/locations` 支持 `parentId`、`search`（标题）、`selectedId`、`excludeId`、`page/pageSize`，复用创建动作的数据范围、租户、字段读权限与祖先ACL，分页返回完整breadcrumb；最终写入再次由现有Application Commands授权。

创建Space契约为 `{name, description?, icon?, sortOrder?}`，不接收code/status；code由UUIDv7身份生成`SPACE_<32位UUID>`，保留现有租户唯一约束，唯一冲突在新事务中最多重试两次。未填写顺序时在租户事务锁内按现有最大顺序+10排列。已有空间code不变；更新仍使用expectedVersion与原字段权限。图标选择与侧栏/管理列表共用现有Ant Design图标映射，默认book。数据库结构与依赖不变。

## Publishing actions and working changes (Knowledge 2.1.2)

Authorized editors publish directly from the reader header; the editor uses a sticky save/publish toolbar. Publication visibility requires current Page edit authority, resource update and status field write/read, plus the existing publish command's readable content fields. Historical readers never receive the mutable change flag.

`GET /knowledge/pages/:id` adds optional `hasUnpublishedChanges` for authorized publishers. The same scoped detail SELECT compares working title, canonical JSON body, description, content mode, sorted tags and the bidirectional set of file IDs/roles against the immutable current publication. Technical version increments, ordering, ACL and asynchronous preview state alone do not indicate new content. Drafts without a publication return true. The published reader can show old published content while this flag describes its current working changes.

Reader publication fetches `mode=working` with no browser cache immediately before submitting `expectedVersion`; editor publication drains the existing draft queue and additionally checks the server version without adopting another editor's lock. Concurrent changes return409 and retain local input. Existing `KnowledgeApplicationService.publish()`, ACL checks, tenant isolation, audit and immutable version/file snapshots remain authoritative. A false flag suppresses the prominent publish action; the existing explicit API command semantics are unchanged.

## Knowledge 2.2 阅读门户与管理工作台

`/knowledge` 是全部读者（包括管理员）的默认阅读首页，展示实际可见空间和最近发布的10条知识。搜索继续使用原有 PostgreSQL 搜索、字段权限及 ACL；尚未提取的 Office/PDF 文件正文不承诺全文检索。`/knowledge/spaces/:id` 复用同一懒加载树，按层级浏览；`/knowledge/pages/:id` 是稳定的发布阅读链接，`versionId` 仍受当前 ACL 与历史快照交集限制。

管理入口为 `/knowledge/manage`，页面及文件位于 `/knowledge/manage/pages/:id`，空间、归档和回收站分别位于 `/knowledge/manage/spaces`、`/knowledge/manage/archive`、`/knowledge/manage/trash`。复用原2.1.2编辑器、自动保存、409、上传幂等、发布和私有文件接口。旧分享链接不变；旧 `mode=working`/`edit=1` 只有具备实际页面维护能力时才映射到管理路由，读者不会因此请求工作副本。

新增只读 `GET /api/v1/knowledge/capabilities` 从现有资源动作、字段读写、数据范围、Space/Page/Ancestor ACL 查询可用的管理区域，只返回布尔能力，不授予权限；每个目标命令继续独立重新验证。空间创建不依赖已有空间 ACL，创建后仍由现有命令检查新记录的数据范围。列表主文件元数据按 `attachmentIds` 字段权限过滤，已发布列表仅连接不可变发布文件关系；排序和更新元数据采用发布时间，避免泄露未发布修改。下载和预览继续通过授权文件接口（含Range），没有公开URL或URL token。

本轮无数据库迁移、新依赖或文件存储结构变更。窄屏布局仅作用于 Knowledge shell。验收报告见 `outputs/KNOWLEDGE_2_2_ACCEPTANCE.md`，唯一恢复入口为 `outputs/KNOWLEDGE_2_2_PROGRESS.md`。

# Knowledge publishing UX acceptance

状态：已完成 / PASS，已部署，真实管理员浏览器验收与清理通过。
验收时间：2026-10-09T23:56:26+08:00。
部署SHA：`4e5583474421fd215438d0577cfe9140d85711b5`，HEAD/Web/API完全一致。范围：Knowledge 2.1.2；不包含Knowledge 2.2或其他模块。

## 审查结果与实现

确认存在的缺陷：阅读页没有直接发布入口，编辑位于更多菜单；编辑保存/发布在页面底部；只要存在发布版本就无条件显示“存在工作草稿”，没有可靠变更判断。

- 阅读页顶部直接显示受权限控制的“编辑”；草稿有“发布”，已发布且内容有变更时有“发布新版本”。无需先进入编辑器。历史阅读不展示发布。
- 编辑页顶部使用sticky操作栏，包含“保存”“发布/发布新版本”“保存并返回”和Autosave状态。无变更不突出重复发布，也不显示错误的草稿提示。
- 服务端同一个受租户/页面范围限制的详情SELECT返回可选`hasUnpublishedChanges`。比较当前工作数据与不可变发布快照的标题、规范JSON正文、说明、内容模式、排序后标签及双向文件ID/角色集合。草稿没有发布快照时为true；恢复与发布相同的数据后为false。
- 不使用技术version或单一contentHash判定变更：排序/ACL/预览变化不是内容变化；FILE发布hash原本组合主文件SHA，与working hash不可直接比较。
- 阅读页每次发布先直接GET最新working详情（no-store），使用返回的expectedVersion。编辑页继续先排空原DraftSession队列，再校验最新服务端版本等于会话版本，禁止默默采用其他编辑者的版本。POST继续使用现有KnowledgeApplicationService.publish()。
- 同步ref阻止重复点击；具体错误留在页面并显示消息。409保留编辑输入，不自动重试覆盖。成功刷新Knowledge查询、树、阅读页和版本状态；最新草稿无修改则不POST。
- 发布可见性同时要求Page.canEdit、knowledge-pages update及status字段read/update，并沿用发布需要的正文等字段读取权限。服务端独立检查权限、ACL、租户与expectedVersion；无权读者及历史阅读不返回工作变更标志。

## 修改文件

|文件|内容|
|---|---|
|apps/api/src/modules/knowledge/knowledge-publication.ts|发布数据与快照的SQL比较表达式|
|apps/api/src/modules/knowledge/knowledge.query.service.ts|详情同查询返回权限受控标志|
|packages/contracts/src/knowledge.ts|可选hasUnpublishedChanges响应类型|
|apps/web/src/modules/knowledge/knowledge-publish.ts|沿用平台权限的发布显示判断|
|apps/web/src/modules/knowledge/KnowledgePages.tsx|阅读页顶部操作、最新版本读取、失败及刷新|
|apps/web/src/modules/knowledge/KnowledgeEditor.tsx|固定操作栏、真实草稿提示、串行保存发布及并发复核|
|apps/web/src/modules/knowledge/knowledge.css|固定操作栏样式|
|apps/web/src/modules/knowledge/KnowledgePages.spec.tsx|发布专项及原Autosave/FILE回归|
|apps/api/src/modules/knowledge/knowledge.publication.spec.ts|字段/ACL/历史元数据授权测试|
|apps/api/src/modules/knowledge/knowledge.publication.database-validation.ts|真实事务/快照/变更判定与拒绝|
|apps/api/src/modules/knowledge/knowledge.files.database-validation.ts|FILE主文件、附件、预览和历史回归|
|apps/api/src/modules/knowledge/knowledge.database-validation.ts|接入隔离数据库专项|
|apps/web/e2e/knowledge-ui.spec.ts|Chrome真实TipTap/sticky/直接发布/新版本锁|
|docs/knowledge-base.md|详情契约与发布操作文档|
|outputs/CODEX_PROGRESS.md|唯一任务进度入口|

API：没有新增路由。已有GET /api/v1/knowledge/pages/:id新增可选派生响应字段hasUnpublishedChanges；POST /pages/:id/publish契约及command保持不变。没有数据库migration、表结构或文件存储调整；没有新增npm依赖；Tags输入未重新引入。

## 自动化验证

最终：Knowledge API11套104 PASS、Web9文件81 PASS（新增7项API、16项Web专项）；API全量96套833 PASS/1原有skip，Web全量38文件293 PASS；真实PostgreSQL隔离验证94场景/85 fresh migrations PASS并清理临时数据库；Chrome4 PASS/1运行时凭据门控skip（该门控用例未读取凭据；独立生产管理员浏览器11项PASS）；根lint/typecheck/build及最终API/Web构建PASS。数据库证据：KNOWLEDGE_PUBLISH_DATABASE_VALIDATION.json。

原有宿主Node22 engine提示（生产Docker使用Node24）、Portal fast refresh和打包chunk提示保留。早期测试mock/中文按钮定位/TS选项及新增DB验收清理锁已纠正；首次全量API无关Excel测试5s超时，15s重跑全量通过，未改其他模块。

## 备份、部署、管理员验收

备份：20261009_234851（retained legacy/KDOS/uploads），pg_restore目录检查、上传归档含.private及三个SHA256复核PASS，详细哈希见KNOWLEDGE_PUBLISH_LIVE.json。执行 ./scripts/deploy.sh all；源码SHA 4e5583474421fd215438d0577cfe9140d85711b5（未push，源码14文件提交）。上线健康/SHA检查已PASS：HEAD/Web/API完全一致，四服务healthy；原PG容器ID、挂载和15433回环端口不变，API仍postgres:5432。TypeORM85已应用/0待运行。管理员实际验收11项PASS，完成后再次healthcheck/deploy check PASS。凭据仅运行时消费，无录制/token/密码/浏览器状态持久化，不改账号或权限。

## 人工验收步骤

1. 管理员打开一个FILE或在线文章草稿阅读页：顶部可见“编辑”“发布”，直接发布后看到版本V1。
2. 重新打开未修改的发布页及编辑器：没有突出的重复发布按钮，不提示存在未发布修改。
3. 编辑长文章，向下滚动：顶部保存/发布仍可操作。修改正文或标题后直接发布，确认Autosave内容正确。
4. 仅修改标题并保存返回：阅读页仍展示原发布标题，但顶部出现“发布新版本”；点击后树、页面标题及版本号更新。
5. FILE仅替换主文件或仅增删附件：出现新版本发布；发布后提示消失，V1/V2历史原件及在线预览仍可使用。
6. 两个窗口编辑同页：旧编辑器保存/发布得到409，保留本地输入；不得错误显示发布成功。
7. 在未发布的父页面下发布子草稿：顶部显示后端具体失败原因，页面保留草稿。
8. 有页面编辑权限但无status字段修改权限的账号：不显示发布按钮，直接调用API仍被拒绝。

未测试：本轮未执行生产普通员工发布权限验收，按本次要求使用管理员；自动化覆盖页面ACL、status字段权限、只读、历史及租户/RLS拒绝。没有生产员工PASS声明。生产网络断线场景未人为中断真实连接，自动化验证最新GET失败、发布失败/409、双击及缺失状态均不误报成功；生产真实并发409已验证。无本轮功能遗留。

## 真实管理员浏览器结果

通过正式Web入口使用授权账号；无账号权限或密码变更。全部11项PASS：

|项|结果|
|---|---|
|E2E登录/权限验证|PASS|
|RICH_TEXT草稿阅读页顶部直接发布|PASS；无需编辑前置、发布后无重复入口|
|长文滚动与顶部保存/发布|PASS；滚动1000px仍在视口，标题Autosave后发布V1|
|标题单独修改及最新锁|PASS；缓存之后再次服务端更新，阅读页新GET后发布V2，V1内容保留|
|FILE草稿阅读页直接发布|PASS；真实PDF画布有内容、认证原件正常、无错误修改提示|
|主文件单独替换|PASS；发布V2、DOCX转换预览、PDF V1历史原件保留|
|附件单独增加及移除|PASS；各自需要发布，主文件不变，发布后提示消失|
|排序/相同内容保存|PASS；技术版本递增不会误报需要发布|
|真实并发409|PASS；本地标题保留、发布禁用、未覆盖服务端|
|真实上级未发布拒绝|PASS；明确显示原因、草稿保留、按钮恢复，无假成功|
|清理|PASS；仅自建子树/版本/原件/派生文件清理，cleanupPending=0，审计保留，未建额外Space|

证据：`KNOWLEDGE_PUBLISH_ADMIN_ACCEPTANCE.json`、`KNOWLEDGE_PUBLISH_DATABASE_VALIDATION.json`、`KNOWLEDGE_PUBLISH_LIVE.json`。本轮没有生产账户凭据、token、trace、录屏、截图或登录状态文件进入源码/报告/Git。临时Vite测试服务已关闭；临时验证数据库已清理。

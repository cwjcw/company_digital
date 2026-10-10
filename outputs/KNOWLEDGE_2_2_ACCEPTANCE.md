# Knowledge 2.2 Acceptance

状态：**PASS / 已部署**。完成时间：2026-10-10T08:30:15+08:00。

生产普通员工的正向阅读为 **NOT_TESTED**：已获授权的现有账号登录成功，但实际缺少 Knowledge 阅读资源权限。仅将登录与权限拒绝验证记为 PASS；未修改任何账号、密码或权限。员工可读角色、文件阅读、管理隔离及安全矩阵由隔离自动化覆盖。

## 1. 审查版本与范围

| 检查对象 | 实际版本 |
| --- | --- |
| 审查时本地 HEAD / GitHub main | `2962713350aba68e6fa3d17316487a8366d43151` |
| 开发前生产 Web/API/Worker | `4e5583474421fd215438d0577cfe9140d85711b5` |
| 两者差异 | 仅5个outputs报告文件，正式2.1.2发布体验源码一致，无回退 |
| 本轮主体提交 | `1316199a0a2a37772c2887b20e2b784c28c4958c` |
| 最终部署 / 当前 HEAD | `3e5fea0b2a31a378fc65bc22b2c27ed7963ce606` |

已审查 AGENTS.md、ARCHITECTURE.md、SECURITY.md、runbook、knowledge-base、Knowledge 2.1/UX/2.1.2/发布体验验收报告，以及 App、ModulePortal、KnowledgePages、Editor、Content、FilePreview、Settings、Access、发布/Autosave工具、CSS、API查询/命令/权限/文件/预览与契约。Git远程实际名为github/gitee；通过github远程确认main，没有变更远程配置。

范围为 Knowledge 2.2 和必要的 App/ModulePortal 导航集成。未修改主计划、设备、研发、订单同步、steel_price、smart-stock、业务数据库配置或文件存储架构。源码已提交；最终报告留在outputs工作区，避免仅提交报告后改变HEAD而造成部署SHA不一致。

## 2. 一个数据模型、两个界面

继续使用既有 Space/Page Tree、ACL、文件资产、工作关系、不可变发布版本及私有文件接口。

- 员工门户由 KnowledgeHome、KnowledgeSpaceBrowse、KnowledgeReader组成，所有读者含管理员默认进入门户。
- 现有KnowledgePages迁为KnowledgeManagement，复用原编辑器、上传器、位置选择器、导入、发布、Autosave和409控制。没有第二套写入流程或旧UI别名。
- KnowledgePageTree从旧组件提取为共享目录：100条分支分页、懒加载、错误重试；切换空间时忽略迟到响应；加载更多有loading并防止重复请求；导航回调变化不会重置已加载树。
- 门户使用既有已发布搜索；最近更新按publishedAt默认10条，支持更多/分页。空间卡片名称/说明/图标来自授权数据库结果，没有写死业务分类、伪造浏览量或全租户知识数量。
- 搜索展示允许读取的标题、空间、完整路径、摘要、类型、发布时间。沿用标题/原件名/说明/标签/路径/已有在线文章正文索引，不宣称未提取Office/PDF正文已支持全文检索。
- FILE复用PDF.js/Worker预览；在线文章复用KnowledgeContent及私有图片上下文；阅读页只保留阅读、分类、下载和独立管理入口。发布控制位于管理界面。
- Knowledge专用shell移除重复的全局业务侧栏，并仅在Knowledge页面解除body的1180px最小宽度。390px首页和PDF阅读已实测无页面横向溢出。

## 3. 最终路由

| 路由 | 用途 |
| --- | --- |
| `/knowledge` | 凯南知识库首页、全局已发布搜索、最近发布与空间卡片 |
| `/knowledge/spaces/:id` | 已发布空间目录；parentId层级/完整路径/空间内搜索与分页 |
| `/knowledge/pages/:id` | 稳定的独立发布阅读链接 |
| `/knowledge/pages/:id?versionId=...` | 受当前ACL与历史权限快照保护的历史阅读 |
| `/knowledge/manage` | 按实际能力进入管理工作台；只有空间管理能力时进入相应区域 |
| `/knowledge/manage/pages`、`/knowledge/manage/pages/:id` | 页面/文件管理、工作草稿、编辑、发布 |
| `/knowledge/manage/spaces` | 空间及授权管理 |
| `/knowledge/manage/archive` | 归档管理 |
| `/knowledge/manage/trash` | 回收站 |

旧settings/archive/trash路径映射到受保护的管理路径。旧页面mode=working/edit=1先检查服务端派生能力，再映射到管理路由；只读用户收到拒绝提示，不请求工作草稿。分享链接与原件/预览URL规则保留。

## 4. API与数据库变化

新增只读 **GET `/api/v1/knowledge/capabilities`**，契约KnowledgeCapabilities仅含布尔值：canManage、canCreatePages、canEditPages、canManagePages、canCreateSpaces、canManageSpaces、canArchive、canTrash。

它组合既有资源动作、字段读写、数据范围及Space/Page/Ancestor ACL：页面编辑目标要求EDITOR，空间管理/页面授权/归档/回收站要求相应FULL_ACCESS与资源动作。没有以用户名、固定角色名或单独isSystemAdmin决定管理入口，没有新建权限体系。空间创建本身没有既有位置ACL；输入相关的数据范围仍由原创建命令对新记录独立验证。

既有页面列表补充按attachmentIds读取权限过滤的primaryFile元数据；发布列表只连接knowledge_page_version_files的PRIMARY关系，工作替换文件不会泄露。发布读取中的updatedAt/updatedBy采用发布记录，发布列表默认排序采用published.published_at，工作模式仍保持原逻辑。未改变发布命令或expectedVersion协议。

**无数据库Migration、无新增npm依赖、无账号或权限修改、无Compose/.env/volume/network修改。**

## 5. 权限安全结果

| 场景 | 自动化结果 |
| --- | --- |
| 系统/Knowledge管理员 | 复用既有管理员判定，仍受租户边界限制 |
| 空间管理员 | FULL_ACCESS与资源/字段/数据范围共同允许相应管理 |
| 编辑人员 | EDITOR与相应字段/动作允许授权区域；不因编辑能力取得空间管理 |
| 普通读者 | 能读取授权发布；管理入口隐藏，管理路由与旧草稿链接拒绝 |
| 无Knowledge读权限 | 模块入口隐藏，直接门户路径拒绝，能力API仍检查读权限 |
| 跨租户/OWN/CUSTOM范围/受限祖先 | 列表、搜索、目录、详情、历史、文件及能力查询使用原边界过滤 |
| 不可见子页面 | 不展示名称，也不通过hasChildren泄露存在 |
| 字段权限 | 文件/正文/路径按原字段权限裁剪；搜索保持既有防侧信道检查 |

所有读操作仍走KnowledgeAuthorizationService事务/tenant context/RLS和知识查询。能力响应不是授权凭据；所有实际写入继续Application Commands、目标权限重新验证、审计及乐观version。文件每次读取（含Range）仍做权限与发布/历史关系验证；没有公共私有文件资源或URL token。

## 6. 自动化验证

| 验证 | 最终结果 |
| --- | --- |
| API全量Jest | 97套通过，841项PASS；1套/1项既有主计划PostgreSQL条件测试skip |
| Web全量Vitest | 40文件，311项PASS，无未处理异常 |
| Knowledge真实PostgreSQL隔离验证 | 101项PASS；含真实非owner RLS、租户/字段/祖先ACL、发布快照、105条目录、同名完整路径、主文件替换及权限派生 |
| 全新库迁移验证 | 85个既有Migration全部通过；未新增Migration |
| Chrome仓库E2E | 7项PASS；1项运行时凭据门控skip（真实生产验收独立执行） |
| 部署Web上的隔离只读Chrome文件测试 | DOCX/PPTX/PDF 3项PASS，非空PDF.js画布、原件下载、header认证、发布scope、管理隐藏；API拦截fixture，非生产员工验收 |
| API/Web类型检查 | PASS |
| API/Web lint | PASS；Web仅1条既有ModulePortal Fast Refresh warning |
| API/Web build | PASS；保留既有打包体积warning，生产Node24；宿主机Node22的engine提示未引入新依赖 |

主要命令：

```bash
pnpm --filter @tracker/api exec jest --runInBand --testTimeout=15000
pnpm --filter @tracker/web exec vitest run --maxWorkers=2 --testTimeout=15000
pnpm --filter @tracker/api typecheck
pnpm --filter @tracker/web typecheck
pnpm --filter @tracker/api lint
pnpm --filter @tracker/web lint
pnpm --filter @tracker/api build
pnpm --filter @tracker/web build
KNOWLEDGE_VALIDATION_REPORT=KNOWLEDGE_2_2_DATABASE_VALIDATION.json node scripts/validate-knowledge.mjs
E2E_BASE_URL=http://127.0.0.1:15175 pnpm --filter @tracker/web exec playwright test e2e/knowledge-ui.spec.ts --workers=1
```

开发时发现并修正SQL能力参数绑定及目录More迟到响应问题，均在部署前通过复测。一次中间全量运行出现既有HR测试环境teardown异步异常；HR独立复核及最终整套通过，未修改HR模块。

## 7. 备份、部署与健康

执行 `./scripts/backup.sh`，备份标记 **20261010_080918**。两份dump的pg_restore目录校验通过，uploads明确包含.private，三个文件权限600。

| 文件 | SHA256 |
| --- | --- |
| `data/backups/four_department_tracker_20261010_080918.backup` | `bae41c5f5c15faf45cf5396891919bc1ab5b60d9650ac929046fcca4b0ab0ae4` |
| `data/backups/kdos_20261010_080918.backup` | `dc6137609d9b06f3e5657e50943e260fdc1ccf0cf011d4f3eaf4f24b8b8f3287` |
| `data/backups/uploads_20261010_080918.tar.gz` | `332d5b6c95723c43a976dfecdd2df4bbb5297dabef900c3a1734a8044ab420b7` |

实际执行 `./scripts/deploy.sh all`，只更新Web/API/document-worker；再执行healthcheck.sh、deploy.sh check及Worker SHA验证。

| 对象 | 最终状态 |
| --- | --- |
| HEAD / Web / API / Worker | 全部 `3e5fea0b2a31a378fc65bc22b2c27ed7963ce606` |
| Web / API / Worker / PostgreSQL | 全部healthy |
| Web / API / Swagger / OpenAPI / PostgreSQL健康检查 | PASS |
| PostgreSQL原容器 | ID仍为`b679ba44dd7507ac797759ed41acdc77f1757f5fcf9bec2f0918565352583c44`，未重建 |
| PostgreSQL原挂载/镜像/回环端口 | `/data/automation/code/work/PMC/knweb/data/postgres` → `/var/lib/postgresql`，postgres:18，127.0.0.1:15433→5432，保留 |
| API数据库连接 | 仍为postgres:5432 |

## 8. 真实浏览器与数据清理

基于生产地址 `http://192.168.1.249:15172`、实际Chrome、现有管理员运行时凭据：

- 门户验收记录15条PASS（其中1条是已授权员工的登录/拒绝验证）；管理回归11条PASS。
- 实际搜索/Space目录/完整路径/稳定阅读、旧编辑链接、真正Worker转换与PDF.js非空像素、Office/PDF原件下载、V1/V2历史、390px布局通过。
- 管理回归覆盖草稿直接发布、长文章固定保存/发布栏、Autosave、标题改名、新版本、主文件替换、附件增删、发布失败具体原因及真实409保留本地修改。
- 两轮仅在现有授权空间下创建唯一前缀的测试子树。最后通过原命令回收并永久清理子树、版本、原件和预览，cleanupPending=0，后续读取返回403/404；必要审计保留，原Space编码/图标/权限不变。
- 凭据仅通过关闭回显的运行时stdin输入。无账号权限/密码变更，无trace、截图、录像、storageState或凭据落盘；报告仅记录E2E登录/权限通过/拒绝与业务验证结果。

**生产员工正向阅读未执行**：现有授权账号登录成功，但缺少Knowledge读权限，模块入口和直接路径正确拒绝。没有擅自扩权，不能把生产员工搜索、Office/PDF阅读记为PASS。对应角色由隔离DB/前端/Chrome测试覆盖。

## 9. 修改、新增文件

源码共23个文件；无源码删除。现有KnowledgeWiki导出迁为KnowledgeManagement，未保留旧UI兼容别名。

| 类型 | 文件 |
| --- | --- |
| 修改 | `apps/api/src/modules/knowledge/knowledge.controller.spec.ts` |
| 修改 | `apps/api/src/modules/knowledge/knowledge.controller.ts` |
| 修改 | `apps/api/src/modules/knowledge/knowledge.database-validation.ts` |
| 新增 | `apps/api/src/modules/knowledge/knowledge.portal.database-validation.ts` |
| 新增 | `apps/api/src/modules/knowledge/knowledge.portal.spec.ts` |
| 修改 | `apps/api/src/modules/knowledge/knowledge.query.service.ts` |
| 修改 | `apps/api/src/modules/knowledge/knowledge.types.ts` |
| 修改 | `apps/web/e2e/knowledge-ui.spec.ts` |
| 修改 | `apps/web/src/App.tsx` |
| 修改 | `apps/web/src/modules/knowledge/KnowledgeFilePreview.spec.tsx` |
| 修改 | `apps/web/src/modules/knowledge/KnowledgeFilePreview.tsx` |
| 新增 | `apps/web/src/modules/knowledge/KnowledgePageTree.spec.tsx` |
| 新增 | `apps/web/src/modules/knowledge/KnowledgePageTree.tsx` |
| 修改 | `apps/web/src/modules/knowledge/KnowledgePages.spec.tsx` |
| 修改 | `apps/web/src/modules/knowledge/KnowledgePages.tsx` |
| 新增 | `apps/web/src/modules/knowledge/KnowledgePortal.spec.tsx` |
| 新增 | `apps/web/src/modules/knowledge/KnowledgePortal.tsx` |
| 新增 | `apps/web/src/modules/knowledge/KnowledgeRoutes.tsx` |
| 新增 | `apps/web/src/modules/knowledge/knowledge-portal.ts` |
| 修改 | `apps/web/src/modules/knowledge/knowledge.css` |
| 修改 | `apps/web/src/modules/portal/ModulePortal.tsx` |
| 修改 | `docs/knowledge-base.md` |
| 修改 | `packages/contracts/src/knowledge.ts` |

交付/证据文件：

- `outputs/KNOWLEDGE_2_2_PROGRESS.md`：本任务唯一主要恢复入口。
- `outputs/CODEX_PROGRESS.md`：指向本任务及保留历史。
- `outputs/KNOWLEDGE_2_2_ACCEPTANCE.md`：本报告。
- `outputs/KNOWLEDGE_2_2_DATABASE_VALIDATION.json`：101项真实隔离DB验证。
- `outputs/KNOWLEDGE_2_2_BROWSER_ACCEPTANCE.json`：真实门户/文件/员工拒绝结果。
- `outputs/KNOWLEDGE_2_2_ADMIN_REGRESSION.json`：真实管理员原流程回归及清理。
- `outputs/KNOWLEDGE_2_2_READER_CHROME.json`：隔离只读Chrome文件阅读；明确非生产员工。

## 10. 人工验收步骤

管理员：

1. 登录KDOS，从知识库模块进入 `/knowledge`；首先看到凯南知识库搜索、真实空间、最近发布。
2. 搜索既有已发布知识，检查结果路径/类型/时间；进入空间，点击目录层级、返回上级，打开阅读页面。
3. 阅读DOCX/PPT/PDF和在线文章，翻页/缩放/下载；阅读页面不出现发布/草稿/移动/权限等操作。
4. 点击“进入知识管理”，检查三个新建知识流程、保存位置、批量可编辑标题/移除/失败重试；在线文章编辑滚动时仍可保存/发布。
5. 发布V1，修改标题或替换主文件但不发布：员工阅读链接保持V1。再发布V2，检查阅读、树标题和版本刷新，并通过管理历史入口查看V1。
6. 从管理界面返回知识库。对人工新建的测试内容自行通过原回收站流程清理，勿操作正式业务知识。

普通读者（必须由现有权限管理员按正常流程预先授权；本轮未调整账号）：

1. 使用确有知识空间/Page/字段阅读权限的账号登录，确认进入 `/knowledge`，可搜索/浏览被授权的发布内容。
2. 阅读Office/PDF/文章和授权下载；不应看到管理按钮或未发布标题/主文件。
3. 直接输入管理路由及旧mode=working/edit=1链接，应拒绝；无权Space、页面及历史文件不得泄露。
4. 目前本轮授权账号缺少阅读权限，实际应看不到知识模块，直接进入显示权限拒绝。不要将该状态记为正向阅读验收通过。

## 11. 未测试及完成范围

已完成所有本轮源码、自动化、备份部署、四端版本/健康、真实管理员验收及清理。生产员工正向可读场景为NOT_TESTED（现有授权不足，未扩权）；生产跨租户真人账号/空间管理员/编辑人员账号未提供，使用隔离安全矩阵验证；不擅自创建或借用账号。

主计划shipping-window真实PostgreSQL条件测试未开启KDOS_POSTGRES_INTEGRATION，属既有非Knowledge环境项。仓库Chrome运行时凭据门控项未注入真实凭据，生产验收通过独立不落凭据的脚本执行。员工隔离Chrome使用API拦截fixture，真实Worker及权限/RLS分别由管理员线上验收和隔离数据库验证。

本次未开发收藏、排行榜、推荐或正文提取，也未创建第二套数据库/ACL/文件体系。

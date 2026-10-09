# Knowledge 2.1 用户体验完善验收

**结果：PASS，已部署并完成管理员真实浏览器验收。**

完成时间：2026-10-09 21:40（Asia/Shanghai）。本地修改前最新基线 `21b9017`，工作区干净；部署提交 `88f48cbdc7536b76686c9342a5a3abde3fe72eba`（未push）。范围限定Knowledge及其类型、测试与文档；未开发Knowledge2.2员工门户。

## 原问题与修复

| 原问题 | 修复后的行为 |
|---|---|
| 默认显示空白父页面下拉；改位置后只能看到“已选父页面” | 统一 `KnowledgeLocationPicker`：默认展示完整保存路径及用户要求的父页面说明；“更改位置”才展开Space和页面树。根目录明确显示“空间根目录”。 |
| 默认保存位置不一致 | 上传、在线文章导入、新建在线页面/子页面及移动共用位置概念；默认当前Space与页面，根目录则使用根目录。在线编写先确认位置，再立即创建持久草稿进入编辑器。 |
| 同名难区分、只查询前100条 | 位置树按层级懒加载，每层分页；搜索服务端按标题筛选，结果显示完整breadcrumb并可分页。已选位置由服务端按ID重新查询授权路径。 |
| 未按目标权限收窄候选、移动只排除本页 | 新位置端点复用既有 Query list 与 Authorization clause，执行租户、create数据范围、Space/祖先rank、字段读权限；移动候选排除本页及全部后代。写入仍由原Application Commands再次校验ACL与循环。 |
| 外部导入按钮与上传菜单含义不明 | “新建知识”集中在线编写、上传文件、从文档导入为在线文章，三个菜单项均有简短说明并受现有权限控制。原始文件服务和文档正文转换服务保持独立。 |
| 创建Space必须手填code，icon为文字框 | 创建契约不再接收code；后端生成稳定 `SPACE_<UUIDv7的32位十六进制身份>`，唯一冲突在新事务中最多重试两次。租户事务锁内默认最大顺序+10；保留原code及唯一约束。图标由14个既有Ant Design图标可视选择，默认书本；选择、预览、列表与侧栏共用映射。 |
| 文章导入仍残留标签输入 | 移除该输入及空tags提交。既有编辑页没有重新添加标签控件，数据库/API/搜索/版本中的Tags继续保留。 |

Autosave、409、草稿、发布及文件版本处理代码沿用现有实现；真实上传/替换/发布/并发验收通过。Space/Page Tree底层仍为spaceId+parentId，ACL继承规则未修改。

## 文件清单

源码/测试/文档共24文件：

- `apps/api/src/modules/knowledge/knowledge.application.service.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.ts`
- `apps/api/src/modules/knowledge/knowledge.database-validation.ts`
- `apps/api/src/modules/knowledge/knowledge.query.service.ts`
- `apps/api/src/modules/knowledge/knowledge.ux.spec.ts`
- `apps/web/e2e/knowledge-ui.spec.ts`
- `apps/web/src/modules/knowledge/KnowledgeFileUpload.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFileUpload.tsx`
- `apps/web/src/modules/knowledge/KnowledgeImport.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeImport.tsx`
- `apps/web/src/modules/knowledge/KnowledgeLocationPicker.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeLocationPicker.tsx`
- `apps/web/src/modules/knowledge/KnowledgePageSelect.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.tsx`
- `apps/web/src/modules/knowledge/KnowledgeSettings.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeSettings.tsx`
- `apps/web/src/modules/knowledge/KnowledgeSpaceIcon.tsx`
- `apps/web/src/modules/knowledge/knowledge-ui.ts`
- `apps/web/src/modules/knowledge/knowledge.css`
- `docs/knowledge-base.md`
- `packages/contracts/src/knowledge.ts`
- `scripts/validate-knowledge.mjs`

记录文件：本报告、`outputs/CODEX_PROGRESS.md`、`outputs/KNOWLEDGE_2_1_UX_DATABASE_VALIDATION.json`、`outputs/KNOWLEDGE_2_1_UX_ADMIN_ACCEPTANCE.json`、`outputs/KNOWLEDGE_2_1_UX_LIVE.json`。运行时管理员脚本位于/tmp，无实际凭据进入源码或报告。

## API与数据库

- 新增 `GET /api/v1/knowledge/spaces/:id/locations`。支持parentId（按层级）、search（标题）、selectedId、excludeId、page/pageSize，返回限定的id/title/parentId/breadcrumb/hasChildren及分页信息；不返回正文或附件详情。
- 调整 `POST /api/v1/knowledge/spaces` 创建契约为 `{name, description?, icon?, sortOrder?}`，code/status不再作为客户端创建字段接收；返回id/version保持。新类型及调用方已同步。
- Space查询、更新和页面关联继续使用既有ID、权限、expectedVersion及审计；旧空间编码保持。实际验收前后已有Space的code/icon/name/status完全一致。
- 数据库migration：**无**。复用现有tenant/code唯一约束、UUIDv7主键和Page Tree模型。
- 新增npm依赖：**无**。Compose、.env、数据库账户/密码和网络配置无修改。

## 自动化测试与构建

| 验证 | 数量/结果 |
|---|---|
| API完整回归 | 94套、818 PASS；1原有skip |
| Knowledge后端专项 | 9套、89 PASS；新增6项UX单测及1项HTTP认证/委托测试 |
| Web完整回归 | 38文件、263 PASS |
| Knowledge前端专项 | 9文件、51项覆盖全部PASS，包含新增Picker/Settings/Import/统一菜单10项回归 |
| 真实隔离PostgreSQL | 81场景PASS；85个fresh migrations PASS；临时库及测试角色已清理 |
| Chrome fixture E2E | 3 PASS；1运行时凭据门控skip，真实生产管理员另测14 PASS |
| API/Web lint及类型检查 | PASS；Web只有原Portal react-refresh warning，无新增warning |
| 根pnpm build、最终Web build、Docker Node24构建 | PASS |
| 部署后/管理员验收后健康检查及版本检查 | PASS |

新增数据库场景包括4个并发Space创建及默认顺序、105个根位置分页/子树懒加载、同名多层路径/工作草稿搜索、选中位置查询、本页及后代排除、真实移动循环拒绝、普通用户create/祖先ACL/字段读权限/OWN数据范围；已有DOCX/Markdown/HTML转换、文件资产/不可变历史、RLS、审计、导入幂等与4000行全量导出回归继续通过。

执行命令：

```bash
pnpm --filter @tracker/api test --testPathPatterns=knowledge
pnpm --filter @tracker/api test
pnpm --filter @tracker/web test --maxWorkers=2 --testTimeout=15000
pnpm --filter @tracker/api typecheck
pnpm --filter @tracker/web typecheck
pnpm --filter @tracker/api lint
pnpm --filter @tracker/web lint
pnpm build
pnpm --filter @tracker/web build
KNOWLEDGE_VALIDATION_REPORT=KNOWLEDGE_2_1_UX_DATABASE_VALIDATION.json node scripts/validate-knowledge.mjs
E2E_BASE_URL=http://127.0.0.1:15175 pnpm --filter @tracker/web test:e2e e2e/knowledge-ui.spec.ts --workers=1
```

过程中修正了菜单文本的精确可访问匹配（标题独立span）以及新增单测等待Modal动画的时机；最终Chrome和完整前后端回归均通过。原宿主Node22 engine、ts-jest、Portal及Vite大chunk提示保留，生产镜像使用Node24。

## 备份、部署与健康

升级前 `./scripts/backup.sh` 完成20261009_212104的legacy、KDOS及uploads三份备份；数据库目录可读取、uploads包括.private、SHA256最终复核通过。

| 备份（data/backups） | SHA256 |
|---|---|
| `four_department_tracker_20261009_212104.backup` | `d7bb2107737dfd86765040acc3c1a84503244371ca8c4c909d613dcbd6f6dd8f` |
| `kdos_20261009_212104.backup` | `61e9bb74780dc4de32620f626c5e1410f599636a76155893670d908041cbeb35` |
| `uploads_20261009_212104.tar.gz` | `b7910f88823772618f7713ea92a347bb290ebbd56b1f01e4531c775ab271692f` |

实际部署命令：`./scripts/deploy.sh all`。最终 `./scripts/deploy.sh check` 输出：

```text
Repository HEAD : 88f48cb
Web Build       : 88f48cb
API Build       : 88f48cb
STATUS          : CONSISTENT
```

Web、API、document-worker、PostgreSQL全部healthy；Swagger/OpenAPI/入口检查通过。原PostgreSQL容器b679ba44及`data/postgres`挂载未重建/删除，仍绑定`127.0.0.1:15433`，API继续使用内部`postgres:5432`。

线上入口：<http://192.168.1.249:15172/knowledge>。

## 管理员真实浏览器验收

仅使用此前授权的管理员运行时凭据，关闭stdin echo；不读取PMC Phase5凭据文件，不改变账户/密码/权限，不持久化token或浏览器state/trace/video/screenshot。实际API与页面交互14项全通过：

| 序号 | 验收内容 | 结果 |
|---|---|---|
| 1 | E2E 登录/权限验证通过；仅管理员，未改账号权限或凭据 | PASS |
| 2 | 仅填写名称/可视图标创建Space；后端自动code和顺序，保存后重新打开图标回显正常 | PASS |
| 3 | Space图标与实际侧栏一致；新建知识菜单统一3流程，外部导入按钮移除 | PASS |
| 4 | 空Space上传不显示空下拉，批量DOCX/PPT/PDF均保存到根目录并保留原件 | PASS |
| 5 | 真实DOCX/PPT/PDF均有实际PDF.js内容画布，原文件认证下载200 | PASS |
| 6 | 统一在线编写流程采用根目录保存位置，真实富文本Autosave与发布正常，无标签输入 | PASS |
| 7 | 位于公司制度时上传自动保存到其下面并继承位置权限 | PASS |
| 8 | 更改位置显示Space和页面树；同名标题按完整路径区分，跨分支选择后实际文件位置一致 | PASS |
| 9 | 新建子页面共用保存位置，并实际写入正确spaceId/parentId | PASS |
| 10 | 从文档导入真实DOCX转换为可编辑富文本并按同一位置保存；原转换/上传服务分离 | PASS |
| 11 | 主文件替换/Autosave/发布V1-V2/历史预览/已有Tags与搜索全部保留 | PASS |
| 12 | 页面移动共用保存位置，完成跨分支移动；后代排除和循环拒绝已由真实隔离DB验证 | PASS |
| 13 | 真实409保留本地内容/禁用发布/不覆盖并发写入；编辑页无标签控件 | PASS |
| 14 | 自建页面/版本/附件子树永久清理，验收Space按现有API归档保留审计；已有Space编码/图标/名称/状态不变 | PASS |

清理结果：所有自建页面、发布版本和文件资产子树已通过正式API永久清理，验收空间剩余页面0；私有对象由既有清理机制处理。测试空间 `01a120de-5ec9-711a-b4c8-9f5b4bea6b35` 按现有空间删除语义归档，保留创建/归档两条必要审计。**现有系统没有空间永久删除API，因此保留这一条已归档的验收空间元数据，不将其表述为物理删除；它不出现在活跃空间选择器。** 未删除或修改已有Space、业务页面或历史文件。

## 未实际在线测试的范围

- 普通员工生产账号：沿用用户仅验收管理员的授权范围；没有更改权限或模拟真实员工登录。普通权限、字段/数据范围、祖先ACL及越权拒绝已经由真实隔离数据库和HTTP/前端自动化覆盖。
- 生产空间人为创建100+页面：未执行，避免污染正式环境；真实隔离库105节点分页与前端搜索/第2页选择/懒加载通过，线上另验证实际多层/同名路径选择。
- Markdown/HTML生产浏览器重新导入：本轮真实浏览器重点验证DOCX；原Markdown/HTML转换专项及数据库回归通过，转换服务未修改。
- 编码真实随机碰撞：不人为破坏生产唯一约束；单测注入23505验证新事务重试和三次上限，真实隔离库并发创建验证唯一性及自动顺序。

## 人工验收步骤

1. 在知识库空间根目录点“新建知识”：检查三个选项及说明，外部无独立导入按钮。
2. 点上传文件：默认显示“当前空间 > 空间根目录”；在公司制度页面再上传，默认显示完整公司制度路径。默认没有空白父页面下拉。
3. 点“更改位置”：展开空间和页面树，展开节点加载下级；同名标题通过搜索结果的完整路径区分，选定后回显完整保存位置。用户只能选择有创建权限的位置。
4. 上传Word/PPT/PDF并检查预览和原件下载；从第三个菜单导入DOCX后确认正文可在线继续编辑。在线编写与新建子页面也先确认同一保存位置。
5. 到空间设置新建正式空间：只填写名称，图标可视点击并预览，顺序留空自动处理；保存并重新打开确认图标一致、无需填写编码。
6. 在自建测试页面验证自动保存、发布两版本、旧版本文件预览及双窗口409；确认页面和导入弹窗均没有标签输入，已有标签搜索仍有效。

# Knowledge Folder Acceptance

交付状态：**PASS（独立文件夹主流程）**。验收日期：2026-10-12（Asia/Shanghai）。
部署 SHA：`d51d6820d9ee9578da3111af4f18988f5c33b4e7`；HEAD / Web / API / Worker 全部一致，四服务 healthy。

管理员在当前生产环境完成13项真实浏览器验收，测试资料已清理。员工真实登录、API拒绝和管理入口隐藏通过；该账号没有Knowledge阅读授权，因此**真实员工正向阅读 NOT_TESTED**，未更改账号权限。授权阅读/ACL/租户隔离已通过隔离PostgreSQL及Chrome自动化验证。

## 1. 旧模型与新模型

| 项目 | 旧模型 | 新模型 |
| --- | --- | --- |
| 目录 | 知识页面充当目录，parentId关联页面 | 独立knowledge_folders，parentFolderId关联文件夹 |
| 目录内容与发布 | 需要页面/草稿/发布 | 只输入文件夹名称，创建立即可见，无正文或发布 |
| 知识归属 | spaceId + 历史parentId | spaceId + folderId，NULL表示空间根目录 |
| 多级结构 | 页面树 | 无固定层级上限的文件夹树，循环由服务端/数据库拒绝 |
| 历史兼容 | 页面ID、正文、文件、版本及ACL | 完整保留；历史页面结构单独显示，不静默转换 |

新建文件、在线文章及文档转换均提交明确folderId，不再创建页面模拟目录。保留2.2居中布局：首页1180px、空间1280px/目录240px、文章900px、文件1180px、管理1320px；手机12～16px安全边距，样式限Knowledge。

## 2. 数据库迁移及发布位置

新增1个迁移：`KnowledgeFolders1722920087000`，2026-10-10备份后成功COMMIT；最后的路由修正不涉及迁移。

- knowledge_folders：UUIDv7、tenant_id、space_id、parent_folder_id、name、sort_order、status、version及标准创建/更新审计字段。
- 同租户/同空间复合外键；同父目录名称唯一索引（包括根目录、忽略大小写/首尾空白）；目录索引、RLS USING/WITH CHECK、循环触发器。
- knowledge_pages新增folder_id，保留原parent_id。
- knowledge_page_versions新增space_id/parent_id/folder_id位置快照；根据原历史breadcrumb安全回填，原正文/文件关系/标签/ACL/历史breadcrumb不改写。
- 迁移在同一事务锁定并比较13张旧知识表的原始全行指纹；不一致就回滚。
- 发布查询、树和搜索使用发布位置；草稿移动在再次发布前不改变员工看到的位置。文件/文章移动不上传或改写原文件；文件夹名称/位置是即时目录元数据，历史版本路径快照保持不变。
- 文件夹删除仅归档空节点。子文件夹、知识、回收站内容或当前发布位置引用均阻止删除，不级联删除正式资料。墓碑保留历史引用和审计。
- 历史父页面仍被其他当前发布版本引用时，禁止永久删除；避免草稿移动期间丢失祖先ACL依据。发布关系形成循环同样拒绝。

Knowledge现存表位于four_department_tracker；本轮不搬库，同时完整备份kdos。PostgreSQL镜像、原容器、原挂载、网络及API数据库配置均未修改。

## 3. 新 API 与权限

| 方法 | 路由（统一/api/v1前缀） | 用途/关键参数 |
| --- | --- | --- |
| GET | /knowledge/spaces/:id/folders | parentFolderId、selectedId、search、page/pageSize、selectable、excludeId；返回完整路径 |
| POST | /knowledge/folders | spaceId、parentFolderId、name；创建文件夹 |
| PATCH | /knowledge/folders/:id | name或parentFolderId，expectedVersion；重命名/移动 |
| DELETE | /knowledge/folders/:id | expectedVersion；仅归档空目录 |

既有页面创建、文件上传、导入commit和页面move扩展folderId契约；旧parentId继续用于历史页面关系，二者ID不能混用。

文件夹继承Space权限，沿用现有knowledge-pages create/update/delete动作和位置字段(parentId)授权；folderId复用位置字段授权，不另建ACL/角色体系。创建/编辑需Space EDITOR，删除需FULL_ACCESS。服务端独立验证，写入使用现有Application命令、租户事务、树锁、乐观version和Audit。仅文件夹管理能力可以进入工作台；页面编辑路由仍要求原页面能力。

目录只返回授权Space的文件夹元数据；知识列表/数量/搜索经过Page ACL、数据范围、祖先和发布状态过滤，不暴露受限页面信息。文件夹移动在所属Space内；文件/文章跨Space移动继续遵守原整子树与ACL管理约束，已在隔离数据库验证。

## 4. 保存位置与上传

管理工作台提供“新建文件夹 | 新建知识 | 上传文件”。统一保存位置选择器用于上传、在线编写、DOCX导入和知识移动，支持空间根目录、逐层展开、空文件夹、完整路径搜索、内联新建和立即选中。

单棵lazy-load Tree按父目录取数据，超过100个子目录继续分页加载；不会将首100项当成完整树。子目录请求失败可以重试。选择器和内容列表均分页。

文件标题、原件、在线预览、批次结果、失败重试继续保留。第一次上传固定file/title/spaceId/folderId/idempotencyKey；网络响应丢失按同一请求重试。改变参数必须明确重新发起请求并使用新键。原未传folderId的客户端幂等契约保留。

## 5. 数据完整性与清理

迁移后、首次清理后及最终新版验收清理后，13张原知识表的记录数与原始全行指纹均一致；仅排除本轮新增的位置列。旧空间编码/图标、归属、草稿状态、正文、ACL及版本JSON保持。

| 表 | 迁移前原始记录 | 最终原始记录 |
| --- | ---: | ---: |
| knowledge_spaces | 2 | 2 |
| knowledge_space_access | 2 | 2 |
| knowledge_pages | 5 | 5 |
| knowledge_page_access | 0 | 0 |
| knowledge_tags | 5 | 5 |
| knowledge_page_tags | 0 | 0 |
| knowledge_file_assets | 4 | 4 |
| knowledge_page_versions | 3 | 3 |
| knowledge_page_version_files | 2 | 2 |
| knowledge_storage_cleanup | 0 | 0 |
| knowledge_page_files | 4 | 4 |
| knowledge_file_previews | 3 | 3 |
| knowledge_file_upload_requests | 57 | 57 |

4个原始文件的实际二进制SHA256及大小逐一匹配，3个原预览文件存在且大小匹配。

共清理三轮仅自建的10个知识页面（原件、预览及测试发布版本随Application API清理）和11个空目录。目录以ARCHIVED墓碑保留，保留必要审计和6条新增幂等请求记录，不直接删除审计。最终仍为5页面、3历史版本、4文件、3预览；自建可见页面0、活动测试目录0、storage_cleanup待处理0。总幂等记录63，其中原57条全行不变。

证据：`KNOWLEDGE_FOLDER_DATA_INTEGRITY.json`、`KNOWLEDGE_FOLDER_CLEANUP_COUNTS.json`。

## 6. 自动化与实际验收

| 检查 | 日期/范围 | 结果 |
| --- | --- | --- |
| API全量Jest | 2026-10-10；最终API代码未再改变 | 97套、843 PASS；1个既有主计划条件测试SKIP |
| 隔离PostgreSQL | 2026-10-10 | 118场景PASS；86个全新迁移重放PASS，临时数据库/角色清理 |
| Web全量Vitest | 2026-10-12 | 42文件、319 PASS，无未处理异常 |
| 仅文件夹管理入口 | 2026-10-12 | 4 PASS；允许工作台、拒绝页面编辑、拒绝无权限、保持页面创建入口 |
| 目录组件 | 三级空目录、105子目录、失败重试 | 3 PASS |
| Chrome端到端 | 2026-10-10；原创建/发布/历史、目录及六视口 | 14 PASS；1运行时凭据门控SKIP，真实生产账号另验 |
| 类型检查/lint/build | API/Web及最终镜像 | PASS；Web仅1个既有Fast Refresh warning及已有大包提示 |
| 真实生产浏览器 | 2026-10-12，最终d51d682 | 13 PASS；清理PASS |

新增必要测试覆盖文件夹唯一并发、循环/非空删除/409、错Space ID、39节点路径与105目录分页、发布位置隔离、跨Space文件移动、权限/RLS/审计、响应丢失幂等、DOCX图像附件与旧历史关系。原Autosave/409、V1/V2、文件预览/下载与PPT等文件回归保留。

最终真实浏览器验证（使用隔离命名前缀保护正式资料）：

1. 管理员实际登录/权限检查。
2. 人力资源下“隔离前缀_公司制度 → 人事制度 → 员工考勤”三级文件夹，仅输入名称，不创建页面/发布。
3. 上传Word/PDF前逐层展开选择空目录，分别编辑标题；批次结果、在线预览非空、原件下载通过。
4. 在线编写沿用当前位置，在选择器中再建空目录并选中，Autosave与阅读页发布通过。
5. DOCX通过实际界面转换为在线文章，选择同一空目录，正文保留。
6. 文件通过界面移动；未发布时员工位置保持，发布新版本后更新，原件/V1/V2保留。
7. 文件夹重命名后子目录/阅读路径正确。
8. 文件夹移动后子目录路径正确。
9. 非空删除、后代循环移动及过期版本409被真实API拒绝。
10. 管理员使用员工门户界面逐层浏览目录，点击文件才阅读；草稿不出现在发布目录。
11. 标题修改、V1/V2、无新增修改不突出重复发布、旧标题历史及标签控件不重现。
12. 1920/1440/1280/768/390/320六视口、五类页面尺寸和居中，无手机横向溢出。
13. 员工真实登录；目录/已发布/草稿API均403，管理区域拒绝且管理按钮隐藏，未改账号权限。

早期验收脚本“完成”按钮的AntD双字空格定位和草稿清理查询已纠正；最终完整流程通过。生产凭据仅TTY运行时输入，无trace/video/screenshot/storageState，无凭据进入源码、Git或报告。

证据：`KNOWLEDGE_FOLDER_DATABASE_VALIDATION.json`、`KNOWLEDGE_FOLDER_BROWSER_ACCEPTANCE.json`；前版已通过证据保留为`KNOWLEDGE_FOLDER_BROWSER_1DBE614.json`，早期中断记录保留备查。

## 7. 备份、部署与健康

- 20261010_100231：初次完整备份。
- 20261010_101548：scripts/migrate.sh在生产迁移前再次备份，执行唯一待迁移KnowledgeFolders并COMMIT。
- 20261012_083917：最后入口修正上线前再次完整备份。

三次均包含four_department_tracker、kdos和uploads（含.private），pg_restore目录验证、SHA256复核通过，备份文件权限600。最后备份SHA256：

```text
four_department_tracker: 12ce7e6b599460ed28c7685e6fad07159f43c8b37e091f1dd118fb44016ea6af
kdos: c60e9a17d946a526021c259ca95833367f65cfecad44a66f91202b32cb4697a7
uploads: 69a21603e31561c15b5eb5cc5346b3fa465b0bea91402222bd8bef2c80244467
```

执行项目标准`./scripts/migrate.sh`及`./scripts/deploy.sh all`，仅重建API/Web/Worker；最终入口修正不再执行数据库迁移。未执行down -v、卷删除或prune。

最终HEAD/Web/API/Worker均d51d6820d9ee9578da3111af4f18988f5c33b4e7。四服务healthy，Web/API/Swagger/OpenAPI/Worker及PostgreSQL健康检查PASS。PostgreSQL仍为原b679ba44容器、postgres:18、原data/postgres挂载；127.0.0.1:15433保持仅本机监听。API仍使用postgres:5432，环境/密码/权限未变。

证据：`KNOWLEDGE_FOLDER_DEPLOYMENT.json`。访问：http://192.168.1.249:15172/knowledge/manage 。

## 8. 未测试项与边界

真实员工正向授权阅读NOT_TESTED：现有授权验收账号缺Knowledge阅读权限。已验证真实登录与实际403/UI拒绝；授权正向阅读、Page ACL/字段/数据范围/租户RLS通过自动化。不扩权，也不将管理员门户界面或fixture员工等同生产员工正向验收。

超过100子目录和39节点深度在自动化/隔离数据库验证，未在生产创建大量测试目录。跨Space文件移动在隔离数据库验证；生产真实验收使用人力资源空间内的自建资料。

无剩余开发、迁移、部署或清理问题。无新增npm依赖，不修改主计划、设备、研发、订单同步及其他业务模块。

## 9. 修改文件（39个源文件）

- `apps/api/src/migrations/1722920087000-KnowledgeFolders.ts`
- `apps/api/src/modules/knowledge/knowledge-publication.ts`
- `apps/api/src/modules/knowledge/knowledge.application.service.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.ts`
- `apps/api/src/modules/knowledge/knowledge.database-validation.ts`
- `apps/api/src/modules/knowledge/knowledge.files.service.ts`
- `apps/api/src/modules/knowledge/knowledge.folder.ts`
- `apps/api/src/modules/knowledge/knowledge.folders.database-validation.ts`
- `apps/api/src/modules/knowledge/knowledge.folders.service.ts`
- `apps/api/src/modules/knowledge/knowledge.import.service.ts`
- `apps/api/src/modules/knowledge/knowledge.module.ts`
- `apps/api/src/modules/knowledge/knowledge.portal.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.query.service.ts`
- `apps/api/src/modules/knowledge/knowledge.scope.ts`
- `apps/api/src/modules/knowledge/knowledge.types.ts`
- `apps/web/e2e/knowledge-ui.spec.ts`
- `apps/web/src/modules/knowledge/KnowledgeFileUpload.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFileUpload.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFolderTree.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFolderTree.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFolders.tsx`
- `apps/web/src/modules/knowledge/KnowledgeImport.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeImport.tsx`
- `apps/web/src/modules/knowledge/KnowledgeLocationPicker.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeLocationPicker.tsx`
- `apps/web/src/modules/knowledge/KnowledgePageTree.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.tsx`
- `apps/web/src/modules/knowledge/KnowledgePortal.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgePortal.tsx`
- `apps/web/src/modules/knowledge/KnowledgeRoutes.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeRoutes.tsx`
- `apps/web/src/modules/knowledge/knowledge-file-upload.spec.ts`
- `apps/web/src/modules/knowledge/knowledge-file-upload.ts`
- `apps/web/src/modules/knowledge/knowledge-ui.ts`
- `apps/web/src/modules/knowledge/knowledge.css`
- `docs/knowledge-base.md`
- `packages/contracts/src/knowledge.ts`

记录文件：本报告、KNOWLEDGE_2_2_PROGRESS.md（唯一主要恢复入口）、CODEX_PROGRESS.md（指针与历史）、数据库/浏览器/完整性/清理/部署证据JSON。源码提交1dbe614及最终d51d682；输出记录保留在outputs，不为更新报告改动运行SHA。

## 10. 人工复核

1. 登录，进入“知识库 → 知识管理”，选择人力资源；旧知识继续可见。
2. 点击“新建文件夹”，输入“公司制度”；进入后创建“人事制度”和更深子目录，检查面包屑及展开/折叠。
3. 点击“上传文件 → 更改位置”，逐层展开选择目标目录，确认完整路径；上传Word/PDF，修改各自标题，查看批次草稿与预览。
4. 通过“新建知识”分别在线编写及DOCX导入，在同一选择器中选择空目录或内联新建目录。
5. 阅读草稿并发布；修改标题后发布新版本，查看原件及V1/V2。
6. 用“移动到”更改文件位置；发布前旧发布位置保留，发布后切换。重命名/移动文件夹后子目录路径立即正确。
7. 尝试删除非空目录及移动到后代，确认明确拒绝；资料移走并发布后可删除空目录。
8. 在正常授权的员工账号下检查只出现授权发布知识；现有本轮账号无Knowledge读权限时应继续拒绝，不由Codex修改权限。

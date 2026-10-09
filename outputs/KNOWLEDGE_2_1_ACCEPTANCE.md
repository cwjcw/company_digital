# Knowledge 2.1 验收报告

状态：**代码完成 / 自动化测试通过 / migration完成 / 部署完成 / 管理员18项验收PASS**。员工真实账号验收未执行（用户仅授权管理员），员工ACL/RLS自动化测试PASS。完成时间：2026-10-09 18:34（Asia/Shanghai）。

## 1. 实际代码审查

初始本地HEAD/远程main为ba91c5d，运行API/Web为已验收5e89cd7；没有回退。读取项目AGENTS、架构、安全、runbook、KDOS表单Skill及Knowledge2.0报告/迁移/前后端/权限/存储/部署。保留已验证Space/Page树、统一KnowledgeAuthorizationService、字段/数据范围、祖先和历史ACL、不可变发布快照、TipTap与串行autosave、审计、富文本导入和PostgreSQL搜索。原附件归属/20MB内存上传/整件Buffer读取不适合独立大文件及可靠转换，改为统一资产、显式工作/发布角色、磁盘上传、流式私有读取及独立持久Worker。

## 2. 保留、删除、重构、新增文件

无关业务源码未改，旧migration未改，先前导入输出未覆盖/提交。没有删除物理源码文件；移除旧内存上传Application入口和旧附件上传/下载路由，替换原附件表/关系名，移除detached_at，未增加兼容Adapter。保留小型富文本导入解析及图片命令，仍写同一文件资产/角色表。全部本次源码/配置修改如下：

- `apps/api/Dockerfile`
- `apps/api/package.json`
- `apps/api/src/migrations/1722920086000-Knowledge21FilePages.ts`
- `apps/api/src/modules/knowledge/knowledge.application.service.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.controller.ts`
- `apps/api/src/modules/knowledge/knowledge.database-validation.ts`
- `apps/api/src/modules/knowledge/knowledge.export.service.ts`
- `apps/api/src/modules/knowledge/knowledge.files.database-validation.ts`
- `apps/api/src/modules/knowledge/knowledge.files.service.ts`
- `apps/api/src/modules/knowledge/knowledge.filter-sources.ts`
- `apps/api/src/modules/knowledge/knowledge.module.ts`
- `apps/api/src/modules/knowledge/knowledge.preview.service.ts`
- `apps/api/src/modules/knowledge/knowledge.query.service.ts`
- `apps/api/src/modules/knowledge/knowledge.range.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.range.ts`
- `apps/api/src/modules/knowledge/knowledge.types.ts`
- `apps/api/src/modules/knowledge/knowledge.upload.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.upload.ts`
- `apps/api/src/modules/knowledge/knowledge.worker.spec.ts`
- `apps/api/src/modules/knowledge/knowledge.worker.ts`
- `apps/api/src/storage/local-object-storage.spec.ts`
- `apps/api/src/storage/local-object-storage.ts`
- `apps/api/src/storage/object-storage.ts`
- `apps/web/e2e/knowledge-ui.spec.ts`
- `apps/web/nginx.conf`
- `apps/web/package.json`
- `apps/web/src/modules/knowledge/KnowledgeContent.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeContent.tsx`
- `apps/web/src/modules/knowledge/KnowledgeEditor.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFilePreview.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFilePreview.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFileUpload.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgeFileUpload.tsx`
- `apps/web/src/modules/knowledge/KnowledgePageSelect.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.spec.tsx`
- `apps/web/src/modules/knowledge/KnowledgePages.tsx`
- `apps/web/src/modules/knowledge/knowledge-file-upload.spec.ts`
- `apps/web/src/modules/knowledge/knowledge-file-upload.ts`
- `apps/web/src/modules/knowledge/knowledge-ui.ts`
- `apps/web/src/modules/knowledge/knowledge.css`
- `compose.yaml`
- `docs/runbook.md`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/knowledge.ts`
- `pnpm-lock.yaml`
- `scripts/deploy.sh`
- `scripts/healthcheck.sh`
- `scripts/migrate.sh`
- `scripts/validate-knowledge.mjs`

新增记录：KNOWLEDGE_2_1_PROGRESS.md、PHASE_A.md、PHASE_B.md、DATABASE_VALIDATION.json、CONVERSION_VALIDATION.json、本报告；同步CODEX_PROGRESS.md。浏览器/转换/健康证据完成后补在后文。

## 3. 数据库和migration

新增正式migration `Knowledge21FilePages1722920086000`，已执行COMMIT。旧knowledge_attachments重命名knowledge_file_assets，旧knowledge_page_version_attachments重命名knowledge_page_version_files且attachment_id改file_id；全部原ID、key、SHA、已发布关系保留。Page/Version增加content_mode及description；新增knowledge_page_files、knowledge_file_previews、knowledge_file_upload_requests。13张Knowledge表均含7个标准审计/tenant/version字段并保持RLS。新增唯一PRIMARY约束、不可变原件metadata、不可变发布关系和延迟的FILE发布主文件约束。无意修改intelligence/生产计划/设备业务表。down明确拒绝丢弃文件知识，回退须验证备份与匹配旧应用。

## 4. 文件和版本关系

Page是唯一知识入口，RICH_TEXT/FILE共用空间/树/权限。原件是不可变fileId+SHA资产；工作关系明确PRIMARY/INLINE/SUPPLEMENTAL；后台PDF是Derived Preview，不算用户附件。上传创建FILE DRAFT；替换只更新工作PRIMARY，发布快照绑定具体fileId/role/mode/description及正确hash。V1/V2原件、预览及历史不会混用。旧文件没有工作关系但有历史关系时仍保留。后台重建不改变发布业务快照。

## 5. ObjectStorage和大文件

扩展原ObjectStorage而非绕过：put支持Readable/Buffer、stat、openStream及精确包含端点的Range。Local实现原子临时文件写入并rename；Knowledge磁盘Multer→统一加密检测→签名/ZIP校验→流式SHA/存储。默认100MB，可配置1–100MB，Nginx104MB预留multipart，独立富文本转正文导入维持20MB解析界限。206、Content-Range、Accept-Ranges、416和HEAD均经过同一授权后处理。null不是可公开URL；storageKey不返回给前端。

## 6. 文档Worker

独立document-worker，主API不安装/运行LibreOffice。PostgreSQL持久状态PENDING/RUNNING/SUCCEEDED/FAILED，唯一tenant/file/SHA/converterVersion，SKIP LOCKED原子领取、租约和最多3次崩溃恢复，拒绝旧租约完成；管理员重试计数另保留。非root、单并发、1CPU/1536MB/pids128、只读根、512MB tmpfs、cap_drop ALL/no-new-privileges，运行只有internal转换网络、无端口、DNS外部解析受限。专用LO profile最高宏安全等级，禁止更新远程链接；超时杀完整进程组、finally清理临时文件、校验原件SHA与PDF。失败不删除原件、不修改发布快照。构建阶段下载使用host网络/HTTPS代理，与运行网络隔离分开；预定义代理参数不保存为运行环境。

## 7. PDF.js预览

新依赖：Web pdfjs-dist ^6.4.299；API yauzl ^3.4.0及dev @types/yauzl ^3.4.0，pnpm-lock更新。未增加其他UI/Excel框架或数据库平台。授权Header传输，不使用URL JWT；PDF.js关闭自动全量预读，Range块65536字节、真实canvas、页码/上一页下一页/缩放/全屏/进度。Office转PDF；Excel明确打印区域/分页可能不完整，提供原件下载。图片授权BlobURL、TXT前200KB阅读；进行中和失败消息明确，管理员可重试，阅读器可重新加载。

## 8. API

均前缀 `/api/v1/knowledge`：

| 方法 | 路由 | 行为 |
|---|---|---|
| GET | files/upload-limits | 上传大小/单批20/类型 |
| POST | pages/files | 单文件原子创建FILE草稿，持久幂等；前端以逐文件命令完成部分成功批量 |
| POST | pages/:id/files | PRIMARY替换、INLINE/SUPPLEMENTAL，expectedVersion |
| DELETE | files/:id | 移除当前补充/正文关系，历史保留，PRIMARY不可直接移除 |
| POST | files/cleanup | 原有管理员孤儿清理能力更名 |
| GET | files/:id/preview-status | 授权状态/错误/次数 |
| POST | files/:id/retry-preview | 授权管理员FAILED重排 |
| GET/HEAD | files/:id/original | 授权流式原件及Range |
| GET/HEAD | files/:id/preview | 授权正确原件对应的native/derived预览及Range |

原Space/Page/权限/版本/搜索/富文本import/export保留；FILE页面下载原件，禁止误导性的空正文Markdown/HTML导出。mode=working与versionId分别明确工作/历史范围。

## 9. 权限

所有端点继承AuthGuard。Query先复用KnowledgeAuthorizationService的tenant、table action、field read、data scope、Space、全部祖先/Page effective ACL、状态/历史ACL，再检验file/version真实关系；仅通过后读取stat/stream/状态。权限变化立即生效，每个Range/HEAD重新校验；错误fileId/历史错配不可读。重试另要求已有知识库管理员身份；没有创建第二套文件ACL。管理员生产验收不替代员工场景；员工线上未授权，未更改任何账号权限/密码。

## 10. 前端

新建下拉在线编写/上传文件，目标Space/父页面复用Page树。单次最多20，逐文件XHR进度；成功项草稿ID保留、失败项明确错误、重试复用稳定key，运行ref防重复。FILE与文章统一标题/标签/位置/说明/附件/发布表单，主文件独立替换；图片paste/drop标INLINE，附件选择标SUPPLEMENTAL。隐藏工作修订显示但保留409并发/串行保存；标签占位“添加标签...”，发布突出。待转换页面可发布，阅读明确显示处理中/失败。

## 11. 搜索

既有pg_trgm/GIN/Search Query扩展已发布标题、说明、标签、Space/路径、主文件名和富文本正文；过滤维持原ACL和字段可见边界，不泄漏工作稿/隐藏字段。4000条过滤导出仍全量。尚不提取或搜索DOCX/PPT/XLSX内部文字，不将文件名搜索冒称文件全文检索。

## 12. AI/RAG边界

保留tenantId/spaceId/pageId/versionId/fileId/SHA/publishedAt；转换器版本与处理状态独立。未来提取/OCR/chunk/embedding可从不可变发布版本与原件SHA建立来源、页码和extractorVersion，复用受ACL约束的搜索入口。本次未增加空向量/chunk表、pgvector或Dify。原件、阅读PDF、未来检索派生物三种身份分离。

## 13. 测试

| 验证 | 实际结果 |
|---|---|
| 全API |93 suites、811 PASS、1原有SKIP|
| 全Web |35文件、248 PASS，2workers/15000ms|
| 其他workspace包 |43项PASS；无测试包按现有passWithNoTests|
| 后端Knowledge/Storage专项 |9 suites、90 PASS（为上述API子集）|
| 前端Knowledge专项 |6文件、36 PASS（为上述Web子集）|
| 隔离PostgreSQL |76场景PASS，包括已有2.0数据升级、租约完成/恢复、V1/V2、RLS、ACL、失败重试/清理、4000条全量导出|
| 新数据库migration |85个完整重放PASS，HR seed正确|
| 实际Chrome+fixture API回归 |3 PASS、1环境凭据测试SKIP，未使用限PMC Phase5凭据|
| 实际Office |DOCX/DOC/PPTX/PPT/XLSX/XLS六种PDF转换PASS，非root uid1001/network none；生成legacy原件上传校验也PASS|
| 类型/lint/build |workspace PASS；API/Web最终类型lint PASS，原Portal1warning及build chunk大小warning保留；宿主工具Node22的>=24 engine warning保留，正式镜像Node24构建/运行通过|

首次默认并发造成旧前端5000ms超时，限制并发后全量通过；未修改无关测试。补充转换成功用例发现TypeORM UPDATE返回元组，已修正并经76场景重跑。初次部署create不支持no-deps及手动网络缺postgres别名均已修复。实际页面又发现.mjs MIME和versionId=undefined两个集成问题，已修复并补空versionId回归。后续PPT验收的缩放locator匹配两元素属于脚本问题，修正selector后重验。最终真实18项状态见下一节。无测试错误被隐去或改为虚假PASS。

## 14. 备份

迁移前scripts/backup.sh生成并pg_restore --list验证legacy/KDOS，uploads归档校验，SHA256检查通过；scripts/migrate.sh再做一次最新备份。实际migration使用备份：

- `92d2c52e24f2366327b31d2ceb3a21af8b8b8f79f1a8e280424b932e0f557358  data/backups/four_department_tracker_20261009_180946.backup`
- `d3a6b92ee87a8b4a0e7774b1edb54041283501c25d2bb6a2261782f9056c1081  data/backups/kdos_20261009_180946.backup`
- `b59971448cd482649caae689b8ce48e61795e5f226c15e290de1d66beb5d25a6  data/backups/uploads_20261009_180946.tar.gz`

最初180526三份亦保留且全部sha256sum --check通过，uploads tar列表/CRC检查通过。旧API/Web镜像保留knowledge20-retained-20261009标签，未删除卷或旧业务数据。

## 15. 部署

最终提交 `2c68cc51e5e2890823a16a8cc30d79ea497d9a5a`；Repository HEAD、Web build-info、API health和Worker镜像SHA一致为 `2c68cc5`。最终 `scripts/deploy.sh all`、`scripts/deploy.sh check`、`scripts/healthcheck.sh` PASS；管理员停止/恢复Worker之后再次check/health PASS。API/Web/PostgreSQL/Document Worker均healthy。旧PostgreSQL容器ID与原挂载完全不变，端口仍仅127.0.0.1:15433，API仍DATABASE_HOST=postgres/DATABASE_PORT=5432。Worker仅内部转换网络，无公开端口、无代理运行环境；实际外部TCP1.1.1.1:443阻断PASS。部署细节见KNOWLEDGE_2_1_DEPLOYMENT.json。

实际命令：正式Compose build --build-arg KDOS_BUILD_SHA=<HEAD> api web document-worker；scripts/migrate.sh（新的migration成功COMMIT，无seed，run --no-deps）；scripts/deploy.sh all。部署脚本以up --no-start --no-deps创建Worker，给现有PostgreSQL附加内部网络并设置postgres别名，保留原API网络。两项Compose兼容/别名问题及两项实际预览MIME/缺省版本参数问题均已修正、重新部署并验收。没有push远程；最终产出记录留在工作区，未混入先前任务的未提交报告。

## 16. 真实浏览器

真实生产管理员Chrome验收 **18/18 PASS**，非fixture替代。运行时stdin消耗已授权凭据，无用户名/密码/token记录，无trace/video/截图/storageState，无账号或权限修改。Word/PDF/PPT/XLSX的canvas检查读取非白绘制像素；PPT逐页、125%缩放及全屏也实际操作。直接上传合法28MB PDF及图片，故意伪装PDF失败后两成功草稿保持；合法Range65536字节206和越界416。V1/V2原件/历史预览及错误versionId拒绝，实际匿名原件/预览/状态/Page/Range全部401。失败DOCX实际由Worker生成FAILED，管理员重试、原件仍可下载；停止Worker时API保持healthy，恢复后最终四服务healthy。

| 项目 | 结果 | 实际证据 |
|---|---|---|
|1|PASS|Production administrator login and Portal -> Knowledge|
|2|PASS|Production HR Space selected; no account permissions changed|
|3|PASS|Company-policy directory created through rich-text UI under HR|
|4|PASS|Chinese DOCX uploads through UI and creates an independent FILE draft|
|5|PASS|Real LibreOffice DOCX PDF is rendered by actual PDF.js canvas|
|6|PASS|Native PDF directly renders without a conversion job|
|7|PASS|Real PPTX two-page navigation,125% zoom and fullscreen exercised|
|8|PASS|Real XLSX preview warning and authenticated original Excel download|
|9|PASS|Batch partial success:21MB PDF and image retained as two drafts; disguised PDF rejected; actual206/416 verified|
|10|PASS|File page V1 published with metadata/tags and original file relation|
|11|PASS|Replace primary in working draft; default published V1 and original stay unchanged|
|12|PASS|V2 published; actual V1 history PDF canvas/original remain valid; wrong-version Range denied|
|13|PASS|Actual anonymous originals/previews/status/Page/Range all401; employee ACL/RLS separately automated, no employee live claim|
|14|PASS|Existing TipTap rich text works with automatic persistence|
|15|PASS|Publish then edit/autosave/publish again, no409, technical revision hidden|
|16|PASS|Published primary filename/description/tag/path search and authorized Breadcrumb verified|
|17|PASS|Actual conversion failure is explicit, administrator retry works, original remains; API stays healthy with Worker stopped|
|18|PASS|Only marked acceptance directory subtree purged, original/derived cleanup completed; HR Space and other data retained|

完整证据：KNOWLEDGE_2_1_ADMIN_ACCEPTANCE.json。全部自建目录/子页经正式Application API永久清理，cleanupPending=0，额外孤儿清理没有移除其他文件（removed=0）。只保留元数据审计和非敏感验收记录。首轮/第二轮实际预览失败记录分别保留ADMIN_INITIAL/ADMIN_SECOND供复盘；第三轮缩放selector失败保留ADMIN_THIRD。产品集成问题修正后重验18项全通过，不将旧失败记录冒充最终通过。

**员工生产账号验收NOT RUN**：用户仅授权管理员，未调整员工权限；员工草稿/私密/历史/字段/tenant隔离由76场景DB、HTTP和Chrome fixture自动测试覆盖，不虚报员工线上PASS。

## 17. 未完成/限制和人工验收

授权范围内无未完成项。员工实际账号验收未获授权，明确留作后续可选验收；自动化权限已通过。已实现范围不包括文档文本提取/OCR/RAG；PPT动画/视频不还原、复杂Office排版可能不同，Excel按打印区域分页，完整数据以原件为准。支持格式签名/加密/解压边界校验，但部分内容损坏需转换或阅读器给出明确失败。

人工：Portal进入知识库→人力资源→新建在线编写目录并保存发布→新建上传文件选择目标位置和Word/PDF/PPT/Excel多件→确认逐文件结果与草稿→页面直接预览/PPT翻页/缩放/Excel说明/原件下载→编辑元数据发布V1→替换主文件确认默认V1未变→发布V2再历史查看V1→搜索文件名/说明/标签/路径→损坏转换查看失败与管理员重试→仅将自建验收子树回收后永久清理。不要调整生产员工权限来验收。

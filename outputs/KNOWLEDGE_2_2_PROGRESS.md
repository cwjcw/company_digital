# Codex 工作进度 — Knowledge 2.2

## 任务
任务名称：Knowledge 2.2 独立文件夹目录（保留员工门户与UI Refresh）。
任务目标：独立Folder实体、多层目录、统一保存位置与文件/文章归档；保留原界面、ACL、旧parentId及历史版本。
当前状态：已完成 / 独立文件夹主流程PASS；已备份、迁移、部署并完成真实管理员验收。
最后更新时间：2026-10-12（Asia/Shanghai）。

## 当前阶段
阶段八：独立文件夹模型及发布归属改造。
当前子任务：无；最终部署d51d682，员工正向阅读未测范围见最终报告。


## 独立文件夹恢复入口
- 基线：HEAD/生产eeca5fb；工作区只有前轮outputs记录，保留全部修改。
- 已完成审查：页面parentId承担目录、发布查询使用当前位置，需新增实体和版本归属快照。
- 设计：文件夹继承Space授权，写入复用树事务锁/现有页面动作/版本/审计；独立分页懒加载；新内容只选folderId，旧parentId链以历史页面结构明确展示。
- 迁移：新增knowledge_folders RLS/复合FK/同父名称约束/循环触发器；pages.folder_id；versions.space_id/parent_id/folder_id定位快照。保留原始正文、文件、ACL、版本JSON与链接。
- 下一步：本轮开发/迁移/部署/清理已完成；正常业务及人工复核按最终报告第10节操作，不重跑迁移或重建PG。
- 报告：outputs/KNOWLEDGE_FOLDER_ACCEPTANCE.md。API/数据库变更已获用户授权；无等待确认。

## UI Refresh 恢复入口
- 基线 HEAD：29f328e（用户提交2.2报告），源码与3e5fea0相同；工作区初始干净。
- 已完成：确认1400px共用上限及260px目录问题，加入页面类型样式和移动端12–16px边距。
- 已验证：Knowledge Web 11文件/99测试PASS；typecheck、lint、build PASS（仅既有警告）；Chrome 13 PASS/1凭据门控SKIP，新增六视口共30类页面布局断言全部PASS。
- 已验证：完整Web40文件/311项PASS；备份20261010_091156双库及uploads完成，pg_restore目录PASS，权限600。
- 已部署：./scripts/deploy.sh all PASS；HEAD/Web/API/Worker均eeca5fb3f7c12946dcb47323280f346b9e3f60bc，四服务healthy。
- 已完成：生产管理员浏览器12项PASS，30组几何测量及三类文档预览/原件下载PASS；自建测试子树/版本/文件清理，审计保留。
- 下一步：无本轮未完成项；人工验收见outputs/KNOWLEDGE_2_2_UI_REFRESH_ACCEPTANCE.md。
- 本轮修改：KnowledgePortal.tsx、knowledge.css、knowledge-ui.spec.ts及outputs报告/证据/进度。
- API、数据库Migration、依赖：无。
- 本轮仅修改Knowledge前端布局，前轮完整业务测试结果保留如下。

## 已完成
- [x] 完整读取用户附加任务；读取AGENTS/既有CODEX_PROGRESS；git status干净。
- [x] 本地HEAD2962713350aba68e6fa3d17316487a8366d43151，较已验收4e55834只有5个outputs变动；运行Web/API/Worker=4e5583474421fd215438d0577cfe9140d85711b5，无回退。
- [x] Git远程命名github/gitee而不是origin（未修改远程）；GitHub main已确认等于本地HEAD2962713350aba68e6fa3d17316487a8366d43151。

## 正在进行
- [x] 完成审查：复用发布排序、ACL/数据范围、私有预览、既有编辑/上传/导入/发布；仅补能力查询和快照文件类型。
- [x] 已实现门户首页/搜索/最近发布/Space卡片/目录/独立FILE及文章阅读。
- [x] 旧管理组件与页面树复用，管理路由独立并按服务端实际能力防护，旧工作链接安全映射。
- [x] 发布列表按publishedAt，文件元数据只来自版本关系；发布视图updatedAt/updatedBy来自发布记录。
- [x] API原专项104项通过；新增API门户7项通过；Web门户/管理48项通过；私有预览6项通过。
- [x] API全量97套/841项通过，1个既有主计划PostgreSQL条件测试跳过；隔离DB101项及85个全新Migration通过。
- [x] Web最终全量40文件/311项PASS，无未处理异常；最终目录4项竞态/重复请求/失败重试通过。
- [x] Chrome最终7项通过，1个运行时凭据门控项跳过；生产账号另以无录屏脚本验收。
- [x] API/Web typecheck、lint（Web仅1既有warning）、build通过。
- [x] 备份20261010_080918：两个数据库+uploads（含.private），restore目录及SHA256通过，权限600。
- [x] 主体源码提交1316199；最终回归发现More分支未覆盖竞态，已修正并追加4项专项PASS；修正后的最终40文件/311项全量PASS。
- [x] 最终全量PASS，交付SHA3e5fea0；备份已经核验。
- [x] deploy.sh all完成；四端SHA一致，Web/API/Worker/PostgreSQL healthy，健康/Swagger/OpenAPI检查通过。
- [x] PostgreSQL原容器ID b679ba44、原/data/postgres挂载与127.0.0.1:15433映射保持不变。
- [x] 真实门户15条、管理11条PASS；独立只读Chrome文件3条PASS，明确非生产员工。
- [x] 两轮自建测试子树/版本/原件/预览清理完成，必要审计保留，Space未变；最终健康全PASS。
- [x] 员工登录/拒绝PASS，生产员工正向NOT_TESTED（现有账号缺读权限），未扩权。
- [x] 最终报告outputs/KNOWLEDGE_2_2_ACCEPTANCE.md已生成。

## 待完成
- [x] 员工首页/搜索/发布排序/空间目录/独立阅读。
- [x] 独立管理路由与实际能力检查、旧链接安全映射、窄屏适配。
- [x] 角色、ACL/字段/租户/发布快照、100+树、原流程回归及Chrome测试。
- [x] 备份、部署、HEAD/Web/API/Worker核对、真实管理员验收与测试数据清理、最终报告。

## 修改文件
- apps/api/src/modules/knowledge/knowledge.controller.spec.ts
- apps/api/src/modules/knowledge/knowledge.controller.ts
- apps/api/src/modules/knowledge/knowledge.database-validation.ts
- apps/api/src/modules/knowledge/knowledge.portal.database-validation.ts
- apps/api/src/modules/knowledge/knowledge.portal.spec.ts
- apps/api/src/modules/knowledge/knowledge.query.service.ts
- apps/api/src/modules/knowledge/knowledge.types.ts
- apps/web/e2e/knowledge-ui.spec.ts
- apps/web/src/App.tsx
- apps/web/src/modules/knowledge/KnowledgeFilePreview.spec.tsx
- apps/web/src/modules/knowledge/KnowledgeFilePreview.tsx
- apps/web/src/modules/knowledge/KnowledgePageTree.spec.tsx
- apps/web/src/modules/knowledge/KnowledgePageTree.tsx
- apps/web/src/modules/knowledge/KnowledgePages.spec.tsx
- apps/web/src/modules/knowledge/KnowledgePages.tsx
- apps/web/src/modules/knowledge/KnowledgePortal.spec.tsx
- apps/web/src/modules/knowledge/KnowledgePortal.tsx
- apps/web/src/modules/knowledge/KnowledgeRoutes.tsx
- apps/web/src/modules/knowledge/knowledge-portal.ts
- apps/web/src/modules/knowledge/knowledge.css
- apps/web/src/modules/portal/ModulePortal.tsx
- docs/knowledge-base.md
- packages/contracts/src/knowledge.ts
- outputs/KNOWLEDGE_2_2_PROGRESS.md（唯一恢复入口）、CODEX_PROGRESS指针、KNOWLEDGE_2_2_DATABASE_VALIDATION.json；最终验收报告、真实门户/管理员回归与隔离只读Chrome证据均已生成。

## 数据库 Migration
- 无新增Migration；13表/原件/不可变版本模型保留，无第二套模型或新npm依赖。

## 新增或修改测试
- API新增knowledge.portal.spec.ts与controller认证测试，隔离DB新增knowledge.portal.database-validation.ts；Web新增KnowledgePortal/PageTree专项，原管理/预览回归迁移路由；Chrome新增门户/105条/手机/管理拒绝场景。

## 已运行测试
- API全量841PASS/1既有skip；DB101PASS+85fresh migrations；Web40文件/311项最终全量PASS；Chrome7PASS/1运行时gate skip。
- 类型检查、lint/build通过。已部署3e5fea0b2a31a378fc65bc22b2c27ed7963ce606，四端一致且healthy；真实管理员验收及清理完成。

## 当前已知问题
- 本轮已修复查询/门户/管理/窄屏及More竞态。
- 一次全量测试出现既有HR异步teardown异常；HR单独复核PASS，未修改该模块，最终整套PASS，无未处理异常。
- 无未完成开发或部署；生产员工正向阅读NOT_TESTED，现有账号缺少读权限，未擅自扩权。

## 等待用户确认
- 无。管理员和此前授权员工凭据只能运行时使用，禁止改权限/密码或读取仅限PMC Phase5的凭据。

## 下一步
1. 本轮已完成；人工验收见最终报告第10节。
2. 员工正向验收仅能使用正常授权的可读账号；当前账号没有读权限，不自动更改。
3. 新任务开始时保留本报告和历史，勿重做2.1.2/2.2。

## 恢复执行说明
先读项目规则/适用skill→本文件→git status/diff→第一项未完成；保持2.1.2实现与历史，不重做前轮。不主动创建/授权生产员工；实际未测不报PASS。

## 最终报告
outputs/KNOWLEDGE_2_2_UI_REFRESH_ACCEPTANCE.md（最新，已部署PASS）。
outputs/KNOWLEDGE_2_2_ACCEPTANCE.md（前轮2.2功能验收，保留）。


## Phase 8 — 独立文件夹实现进度（2026-10-10，未上线）
- 已新增knowledge_folders与folder_id；版本位置快照、旧parentId兼容、目录RLS/唯一/循环约束和审计。
- 已接入管理/门户目录、统一保存位置选择器、空目录/内联创建、上传冻结folderId、在线创建/导入/移动。
- 迁移锁定并核对13张原知识表的全行指纹；差异自动回滚。未执行生产迁移。
- API Knowledge原112测试通过；新增controller 2项正在复核；Web原专项修复fixture后正在全套复核。
- 隔离数据库原101项及新增目录前12项通过，文件上传测试中修正双文件共有目标的断言，正在重跑。
- 下一步：专项/Chrome/全量回归→备份及数据基线→迁移部署→真实管理员三级目录/Word/PDF/在线/导入→清理→报告。
- 新增依赖：无；生产仍eeca5fb3f7c12946dcb47323280f346b9e3f60bc，不能称已交付。

### Phase 8 验证更新
- Web全量40文件/312项PASS；Knowledge专项100项PASS；API全量97套/843项PASS，1个既有条件测试跳过。
- 类型检查、API/Web lint、build PASS；仅既有Web warning/打包体积提示，无新增依赖。
- 隔离数据库117项与86个全新migration PASS；新增历史跨空间祖先ACL和发布循环保护后，最终118项复核正在进行。
- Chrome原13项PASS/1运行时凭据门控SKIP；新增独立三级目录专项正在调整准确的树节点定位（测试fixture，不是目录模型缺陷）。
- 真实管理员脚本已准备（只在TTY运行时注入凭据，无trace/video/screenshot/storageState），尚未运行、未宣称验收通过。

### Phase 8 目录交互修正
- Chrome逐层操作确认嵌套Ant Tree无法可靠展开第二层（真实缺陷，纠正前项“仅fixture”判断）。已替换为单棵lazy-load Tree，子目录独立分页/重试，避免事件互相干扰。
- 新增KnowledgeFolderTree专项：三级空目录、105子目录追加、失败重试；前两类之外的重试已PASS，105项正在按15秒专项限制复核。
- 最终隔离数据库118场景/86fresh migrations PASS，含真实非owner RLS、旧数据全行指纹、历史发布ACL、循环和跨Space文件移动。
- 完整备份已生成20261010_100231（双数据库、uploads含.private、SHA256及restore目录），尚未迁移/上线。

### Phase 8 上线准备（2026-10-10T10:13+08:00）
- 最终API全量843 PASS/1既有skip；Web最终41文件315 PASS，无未处理异常；新增目录3项复核PASS。
- Chrome最终14 PASS/1运行时凭据gate SKIP；真正管理员将另行在生产验收，不将fixture员工等同生产员工。
- 最终隔离DB118 PASS/86fresh migrations PASS，含published-parent purge阻断、原数据13表指纹、ACL/RLS/幂等。
- API/Web typecheck、lint已PASS；Web最终build收尾中，源码提交1dbe614（37文件），镜像构建中。
- 已备份20261010_100231，原PostgreSQL b679ba44/原挂载/127.0.0.1:15433保持；实际Knowledge在four_department_tracker（kdos另备份），本轮不搬库。
- 下一步：镜像→scripts/migrate.sh再次完整备份/迁移→13表原始记录指纹核对→deploy.sh all→生产浏览器与清理→最终报告。尚未上线。

### Phase 8 生产迁移与部署完成，真实验收中（2026-10-10T10:19+08:00）
- scripts/migrate.sh再次完整备份20261010_101548后仅执行KnowledgeFolders1722920087000，COMMIT成功。
- outputs/KNOWLEDGE_FOLDER_DATA_INTEGRITY.json：13张原知识表记录数/原始全行指纹均PASS；pages5、versions3、assets4、ACL2等原归属/状态/正文/版本未改。
- deploy.sh all成功：HEAD/Web/API/Worker=1dbe61417274f2c9b0eb8fea117b8cf5ff632898；三服务及PostgreSQL healthy。PG原容器/挂载/端口未变。
- Web最终build24.23秒PASS；所有源码已提交，工作区只剩outputs记录。
- 生产管理员真实浏览器脚本正在验收三级目录、逐层上传Word/PDF、在线/导入、移动/改名、V1/V2、预览及六视口；凭据仅TTY运行时传入，禁用所有录制。
- 下一步：真实验收/自建测试资料清理→旧记录再次指纹核对→最终健康及报告。

### Phase 8 恢复执行（2026-10-12）
- 依规则读取AGENTS/既有进度/git status/diff；源代码干净，仅outputs记录未提交；不重做已完成源码/测试/迁移。
- 当前HEAD/Web/API/Worker仍1dbe614，PostgreSQL原b679ba44容器healthy；迁移前13表的原始记录指纹至今未变。
- 上轮真实验收已完成三级目录/两个草稿上传，脚本“完成”按钮未考虑AntD双字空格，未继续；清理发现search会固定published模式，已将脚本改为按自建folderId分页读working目录。业务源码未改变。
- 正在重跑真实管理员完整验收，并通过Application API清理上一轮仅自建的2草稿/3文件夹，保留审计及目录墓碑；不改账号权限。
- 下一步：真实浏览器各流程PASS→只清理自建记录→当前数据完整性/健康四端SHA→报告与进度完成。

### Phase 8 管理员实际验收与入口遗漏修正（2026-10-12）
- 真实管理员13项PASS，三级目录、Word/PDF逐层上传及非空预览/原件、空目录内联创建、在线/DOCX导入、移动/改名、V1/V2、409、六视口均通过。
- 两轮自建资料共6页/7文件夹已通过API清理；版本/原件/预览清除，审计、幂等记录及目录墓碑保留。13表原始记录再次指纹PASS。
- 员工E2E登录/权限拒绝PASS；真实正向Knowledge阅读NOT_TESTED，现有账号缺Knowledge读权限，未改账号/权限。
- 最后复核发现仅文件夹能力用户会被ManagementGate错误转向：修正workspace=pages||canManageFolders，不放宽单页面编辑路由，新增4项专项全部PASS。
- 正在执行Web全量回归/类型/lint/build；API/DB代码未变，沿用已通过843/118+86迁移证据。随后再次备份、部署所有服务对齐新SHA、重做真实管理员验收与清理。

### Phase 8 最终入口修正待部署（2026-10-12）
- KnowledgeRoutes补充仅文件夹管理的工作台入口，4项专项PASS；Web最终42文件319项PASS，类型/lint/build PASS（仍仅既有1个lint warning）。
- 完整备份20261012_083917：四部数据库/kdos/uploads，restore目录及SHA256通过，权限600。
- 源码追加提交d51d682（仅Knowledge路由/4个测试/模块文档）；deploy.sh all正在构建并部署，数据库无需再次迁移。
- 首轮完整管理员13项及清理证据保存为KNOWLEDGE_FOLDER_BROWSER_1DBE614.json；新版上线后重验并加强员工真实API/管理界面拒绝检查，不更改权限。

## Phase 8 最终交付（2026-10-12，Asia/Shanghai）

### 状态
已完成 / 独立文件夹主流程PASS。
最终报告：[KNOWLEDGE_FOLDER_ACCEPTANCE.md](KNOWLEDGE_FOLDER_ACCEPTANCE.md)。
部署SHA：d51d6820d9ee9578da3111af4f18988f5c33b4e7；HEAD/Web/API/Worker一致，四服务healthy。

### 已完成
- [x] knowledge_folders、分页/懒加载/完整路径/循环/同父唯一/RLS，页面folder_id和独立发布位置。
- [x] 新建/子目录/改名/同空间移动/空目录删除，上传/在线/DOCX导入/知识移动统一逐层选择空目录。
- [x] 原parentId、标题/原件/预览、Autosave/409、幂等重试、版本/ACL和2.2布局保留。
- [x] 仅文件夹管理入口修正，页面编辑权限保持；39个源文件详见最终报告。
- [x] 备份、生产迁移、部署；新版管理员真实浏览器13项PASS，清理10个自建页和11个目录。
- [x] 原13表全行指纹、4原文件实际SHA256、3原预览大小PASS；原5页/3版本/4文件保留。
- [x] 最终报告/证据生成，CODEX_PROGRESS指针同步。

### 正在进行
- 无。

### 待完成
- 无剩余开发、迁移、部署、清理或报告任务。

### 数据库 Migration
新增KnowledgeFolders1722920087000，20261010_101548完整备份后成功COMMIT；目录路由修正无新增迁移。无新npm依赖。

### 新增/修改测试及已运行结果
API全量843 PASS/1既有条件SKIP（API源码未再变）；DB118 PASS/86fresh migrations PASS；Chrome14 PASS/1凭据门控SKIP；Web最终42文件319 PASS，目录3项与新路由4项专项PASS。API/Web类型/lint/build及镜像PASS（仅既有warning）。新版真实生产浏览器13 PASS，真实员工目录/发布/草稿API均403且管理区域隐藏；清理PASS。

### 备份与清理
完整备份20261010_100231、20261010_101548、20261012_083917；双DB/含.private的uploads、restore目录、SHA256、600权限均PASS。
自建可见页0、活动测试目录0、storage_cleanup0；必要审计、11目录墓碑、6新增幂等记录保留，原57幂等记录不变。
原PG容器b679ba44与挂载/127.0.0.1:15433不变，API仍postgres:5432。

### 当前已知问题/未测试范围
无剩余产品缺陷。真实员工正向Knowledge阅读NOT_TESTED：现有账号缺读授权，未改权限；权限正向/ACL/RLS由自动化验证，不冒称生产员工阅读PASS。大量目录/39层路径和跨Space文件移动在隔离数据库验证，生产使用仅自建资料。

### 等待用户确认
无；不自动更改员工权限。

### 下一步与恢复
本轮已完成。用户业务使用/人工复核见最终报告第10节；继续维护时先规范→本文件→Git状态→新问题，不重做阶段八。输出记录保持在outputs，源码已提交；当前运行SHA与HEAD一致。

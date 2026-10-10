# Codex 工作进度 — Knowledge 2.2

## 任务
任务名称：Knowledge 2.2 员工知识门户与管理界面分离。
任务目标：一个知识库、两种界面、同一权限与数据，保留2.1.2创建/上传/重试/Autosave/409/发布/历史/私有预览。
当前状态：已完成 / PASS，已部署。
最后更新时间：2026-10-10T08:30:15+08:00。

## 当前阶段
阶段六：交付完成。
当前子任务：无；HEAD/Web/API/Worker均3e5fea0b2a31a378fc65bc22b2c27ed7963ce606，最终报告已生成。

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
outputs/KNOWLEDGE_2_2_ACCEPTANCE.md（已生成，PASS）。

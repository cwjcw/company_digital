# Codex 工作进度

## 任务
任务名称：修复研发中心 BOM 报表承接事业部高级筛选白屏。
任务目标：确认生产错误、修正通用 candidates 契约与前端异常处理，回归所有受影响资源，部署并完成生产 Chrome 验收及 GitHub 推送。
当前状态：进行中（代码、回归、Lint、typecheck、构建、备份、部署、健康检查和GitHub同步已完成；等待登录态生产 Chrome 页面验收）。
最后更新时间：2026-11-10 20:26（Asia/Shanghai）。

---

## 当前阶段
当前阶段：生产验收与收尾。
当前子任务：等待获准登录态会话，完成生产 Chrome 交互验收。

## 已完成
- [x] 读取用户任务说明、项目 AGENTS.md、kdos-form-platform、kdos-form-validation 及架构/安全/运行手册。
- [x] 检查既有 outputs/CODEX_PROGRESS.md；内容为已完成历史任务，不覆盖该记录。
- [x] 检查 Git：请求分支 `feat/rd-bom-sync-refactor-20261110` 已在 `/tmp/knweb-rd-bom-sync-refactor-20261110` 被占用，工作区干净，HEAD `4aa4b34c2b9659dab4ca62a17df8adb2016ea76b`。
- [x] 当前项目根工作区 `perf/mps-three-tier-sync-20261107` 干净，HEAD `ff947bcc92049e4730aa74c434b876202e35db50`；未切换覆盖或改动该并行分支。
- [x] 生产运行容器 API/Web/PostgreSQL/Document Worker 均 running；Web build-info `99c3701`，API health `22cda3e`，与功能分支基线不同。
- [x] 静态确认 BOM 报表注册 `listRows`，`divisionId` 是 department 字段；通用 candidateOptions 对所有 listRows 返回 `{rows,total,page,pageSize}`，与数组/withMeta 契约冲突；候选默认组织目录最终通过授权资源字段 DISTINCT 相交，不会直接返回全公司部门。
- [x] 移除 candidates 对 listRows 的分页结果分支；保留 rows 分页逻辑，BOM候选查询使用 `mps_order_allocations.division_id` 并通过设置 `app.tenant_id` 的事务执行。
- [x] 前端候选响应运行时校验 Candidate[] 形状；异常显示可重试提示，避免对象被 `.map()` 触发白屏。
- [x] 增加 listRows 资源候选/withMeta/rows 契约回归测试和 BOM divisionId 稳定ID/RLS上下文测试。
- [x] 公共筛选资源注册测试覆盖 logistics-ledger 与 rd-order-bom-report；BOM 派生字段由专用查询器处理。
- [x] 以最终SHA重新部署并确认 Web/API build-info 一致、四个运行容器 healthy。
- [x] 交付报告记录静态根因证据边界、测试、备份、生产发布与未完成的Chrome验收。

## 正在进行
- [ ] 通过已授权生产 Chrome 会话或测试身份复现实际候选响应、浏览器异常栈和事业部数据范围。
- [x] 设计不触碰 BOM 业务计算/同步逻辑的通用候选读取实现；对派生报表使用显式类型化候选提供器，BOM divisionId 从授权 allocation 行读取并按稳定 ID 解析组织名称。
- [x] 盘点全部 listRows 资源：BOM 与 finance monthly 使用正式字段候选解析；finance ranking 使用独立候选提供器；finance movements 与 review due 已通过 candidateVariant 走字段候选服务。
- [x] 将现行生产 Web 提交 `99c3701` 合并进功能分支，保留已上线 MPS 剩余数量修复；完整发布树不再回退生产行为。
- [x] 备份 legacy DB、KDOS DB 和 uploads，均校验可读并生成 SHA256。

## 待完成
- [x] 后端统一 candidates 返回契约与 BOM divisionId 授权范围候选。
- [x] 前端运行时校验异常结构并提供可重试错误提示。
- [x] API/Web/contracts/通用表格筛选回归测试与静态检查。
- [ ] 登录态生产 Chrome 验收（部署和健康核验已完成）。
- [x] 任务代码提交及功能分支推送；远端 SHA 与本地一致：`56fc0f8b80405c840a1c277ca4519543d45cf963`。

## 修改文件
- apps/api/src/common/filtering/table-filter.controller.ts
- apps/api/src/common/filtering/table-filter.controller.spec.ts
- apps/api/src/common/filtering/field-candidate.service.ts
- apps/api/src/common/filtering/table-filter.registry.ts
- apps/api/src/modules/finance/finance-orders.query.service.ts
- apps/api/src/modules/finance/finance-orders.performance.spec.ts
- apps/api/src/modules/rd/rd-order-bom-report.query.service.ts
- apps/api/src/modules/rd/rd-order-bom-report.query.spec.ts
- apps/web/src/shared/advanced-filter.tsx
- apps/web/src/shared/advanced-filter.spec.tsx
- outputs/KDOS研发中心BOM报表高级筛选白屏修复进度.md
- apps/api/src/common/filtering/table-filter-registry.spec.ts
- outputs/RD_BOM_ADVANCED_FILTER_RELEASE_REPORT.md

## 数据库 Migration
- 无；本次仅修改筛选 API/前端候选 UI，不涉及数据库结构或 Migration。
- 上线前备份：`data/backups/four_department_tracker_20261110_200739.backup` SHA256 `da8047244b704c72a89d6b7d8ea412258b2b61c01bce9b2e8c55b1dab67d0169`；`kdos_20261110_200739.backup` SHA256 `68473b11a7cce00d306b3e26b2bc1d4d81e5da6eccd0c05ce1dd0c256d1597cc`；`uploads_20261110_200739.tar.gz` SHA256 `9803eb1c0813aade3a1941067e79192d6f9c436eea56c9a4f35d0e92fdf495d4`。

## 新增或修改测试
- listRows资源的candidates返回候选数组、withMeta返回CandidateResult，rows仍是分页结果。
- 派生finance ranking资源使用类型化候选provider且不把分页对象暴露给候选端点。
- BOM divisionId候选读取tenant RLS上下文并返回稳定divisionId。
- 前端候选接口收到分页对象时显示可重试错误，重试成功后显示事业部候选。
- 合并生产 Web 基线后的 MPS 报工及共享 KdosDataTable 回归。

## 已运行测试
测试名称：生产容器状态、Web build-info、API health、候选/listRows/BOM 静态调用链检查。
结果：生产与初始功能分支版本不同；候选数据契约缺陷成立。初始 API 筛选/BOM/finance 测试28/28，Web高级筛选测试28/28，BOM contracts测试2/2；合并生产 Web 基线后 API 相关43/43、Web高级筛选与共享表格43/43。补齐注册夹具后公共 filtering 回归8 suites/44 tests 全通过。Contracts/API/Web typecheck、API/Web/Contracts build、受影响文件 ESLint 通过。Web build 有非阻塞 chunk size 提示。生产候选实际HTTP响应尚未读取（需有效身份）。

测试名称：功能分支提交与远端SHA检查。
结果：`8712aad`修复、`6c33fd9`现行生产 Web 基线合并、`f2ffd2c`预部署记录、`56fc0f8`注册回归夹具/进度提交均已推送；远端最终 SHA=`56fc0f8b80405c840a1c277ca4519543d45cf963`。

测试名称：生产部署和健康检查。
结果：在工作区 SHA `f2ffd2c` 完成备份后首次部署；最终 SHA `56fc0f8b80405c840a1c277ca4519543d45cf963` 推送后再次执行 `scripts/deploy.sh all`。API、Web、PostgreSQL、Document Worker 均 running/healthy；`scripts/deploy.sh check` 确认 Repository/Web/API SHA 一致，STATUS CONSISTENT。最终 API 镜像 `sha256:e49d4966eadb497431a2b74448dd39113593c0c621f573d1efc20f45ab21c853`；Web镜像 `sha256:c4a12a65e5515e3d067e2e5d9f12766ff7bfd6a1071b2b8b18a72b064607f55d`。

测试名称：最终提交与远端校验。
结果：最终提交 `56fc0f8b80405c840a1c277ca4519543d45cf963` 推送成功；`git ls-remote` 的目标分支 SHA 相同，工作树干净。

测试名称：上线前备份。
结果：legacy、KDOS和uploads备份均成功，见数据库Migration章节记录的路径与SHA256。

## 当前已知问题
- 本机真实 Chrome 无可用远程调试连接：默认用户目录被 Chrome 拒绝启用 CDP；Playwright persistent-profile启动未完成。项目与环境均未配置 KNP_E2E_PASSWORD，故尚不能读取生产真实候选响应或完成授权页面验收。
- 功能分支工作树已有其他任务的最终验收提交且独立存在；不能通过 checkout 改写该目录。已在该既有干净 worktree 继续工作。
- 生产 Web/API SHA 均不等于目标功能分支 HEAD；生产 Web `99c3701`含目标分支之后已上线的 MPS修复，部署前必须防止回退现行生产行为。

## 等待用户确认
- 无。

## 下一步
1. 取得可复用的生产登录态 Chrome 会话或获准的只读/测试身份。
2. 执行BOM高级筛选候选加载、选择/筛选、清空筛选和切换视图验收，并检查浏览器控制台。
3. 将真实候选响应和浏览器验收结果补记至本进度文件与交付报告。

## 恢复执行说明
从本文件继续。保留当前根工作区 perf 分支及所有独立 worktree；代码、自动化验证、部署、健康检查、推送和报告均已完成。唯一剩余工作是用获准的登录态 Chrome 完成用户要求的生产交互验收；项目环境未配置专用测试口令，默认Chrome profile CDP也不可连接。

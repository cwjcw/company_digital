# Codex 工作进度

## 任务
任务名称：修复研发中心 BOM 报表承接事业部高级筛选白屏。
任务目标：确认生产错误、修正通用 candidates 契约与前端异常处理，回归所有受影响资源，部署并完成生产 Chrome 验收及 GitHub 推送。
当前状态：进行中（代码、定向回归、Lint、typecheck、构建已通过；生产运行时授权复现、备份部署与线上验收待完成）。
最后更新时间：2026-11-10（Asia/Shanghai）。

---

## 当前阶段
当前阶段：实现与本地验证完成，准备安全发布。
当前子任务：解决部署源分支落后于生产 Web 的差异，完成备份、发布与线上验收。

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

## 正在进行
- [ ] 通过已授权生产 Chrome 会话或测试身份复现实际候选响应、浏览器异常栈和事业部数据范围。
- [x] 设计不触碰 BOM 业务计算/同步逻辑的通用候选读取实现；对派生报表使用显式类型化候选提供器，BOM divisionId 从授权 allocation 行读取并按稳定 ID 解析组织名称。
- [x] 盘点全部 listRows 资源：BOM 与 finance monthly 使用正式字段候选解析；finance ranking 使用独立候选提供器；finance movements 与 review due 已通过 candidateVariant 走字段候选服务。

## 待完成
- [x] 后端统一 candidates 返回契约与 BOM divisionId 授权范围候选。
- [x] 前端运行时校验异常结构并提供可重试错误提示。
- [ ] API/Web/contracts/通用表格筛选回归测试与静态检查。
- [ ] 生产备份/部署/健康核验与线上真实 Chrome 验收。
- [ ] 仅提交任务文件到已配置 GitHub 功能分支并校验远端 SHA。

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

## 数据库 Migration
- 暂无；预期无需 Migration。

## 新增或修改测试
- listRows资源的candidates返回候选数组、withMeta返回CandidateResult，rows仍是分页结果。
- 派生finance ranking资源使用类型化候选provider且不把分页对象暴露给候选端点。
- BOM divisionId候选读取tenant RLS上下文并返回稳定divisionId。
- 前端候选接口收到分页对象时显示可重试错误，重试成功后显示事业部候选。

## 已运行测试
测试名称：生产容器状态、Web build-info、API health、candidate/listRows/BOM 静态调用链检查。
结果：生产与功能分支代码版本不同；静态候选结构缺陷成立。API筛选、BOM报表与finance ranking定向测试28/28通过；Web高级筛选相关测试28/28通过；BOM contracts测试2/2通过。修改文件 ESLint、contracts/API/Web typecheck 与 contracts/API/Web build均通过。Web构建有非阻塞 chunk size 提示。生产候选实际HTTP响应尚未读取（需有效身份）。

## 当前已知问题
- 本机真实 Chrome 无可用远程调试连接：默认用户目录被 Chrome 拒绝启用 CDP；Playwright persistent-profile启动未完成。项目与环境均未配置 KNP_E2E_PASSWORD，故尚不能读取生产真实候选响应或完成授权页面验收。
- 功能分支工作树已有其他任务的最终验收提交且独立存在；不能通过 checkout 改写该目录。已在该既有干净 worktree 继续工作。
- 生产 Web/API SHA 均不等于目标功能分支 HEAD；生产 Web `99c3701`含目标分支之后已上线的 MPS修复，部署前必须防止回退现行生产行为。

## 等待用户确认
- 无。

## 下一步
1. 核实目标分支完整祖先及部署的 build SHA 是否已包含 BOM 功能，定位可用生产 Chrome/授权身份。
2. 核对生产 Web `99c3701` 之后的 MPS 改动如何随本次 Web 部署保留，核实 API/Web 发布 SHA。
3. 完成生产备份；部署相关服务并做健康检查。
4. 获取授权测试登录态后验收 BOM 高级筛选；当前 E2E 密码和 CDP 会话均不可用。
5. 提交任务文件到 BOM 功能分支并推送，验证远端 SHA。

## 恢复执行说明
从本文件继续。保留当前根工作区 perf 分支及所有独立 worktree；本地代码和自动化验证已完成。发布前继续核对生产SHA和现行MPS功能；线上 Chrome 验收尚未完成，项目环境未配置专用测试口令。

# 研发中心 BOM 报表高级筛选白屏修复交付记录

日期：2026-11-10（Asia/Shanghai）  
功能分支：`feat/rd-bom-sync-refactor-20261110`  
发布版本：`56fc0f8b80405c840a1c277ca4519543d45cf963`

## 根因和证据边界

代码调用链确认了与现象吻合的契约缺陷：`承接事业部`（`divisionId`）是 department 字段，因此高级筛选会进入 CandidateSelect 动态候选加载；`rd-order-bom-report` 注册了 `listRows`，而通用 `candidateOptions()` 对该类资源原先返回报表分页对象 `{rows,total,page,pageSize}`。前端把响应当作候选数组，并在渲染时调用 `.map()`。这会导致该候选控件渲染异常；普通文本、日期等不加载动态候选的字段不经过该路径。

这是基于生产前代码、注册配置与完整静态调用链得到的根因判断。此环境未提供可复用的已登录 Chrome 会话或 `KNP_E2E_PASSWORD`，因此本次**没有**取得生产候选 API 的实际响应、React 浏览器异常堆栈，也没有完成登录态页面复现。不能把上述静态根因表述为已由线上错误堆栈确认。

## 修复内容

- `/table-filters/candidates` 不再复用 `listRows` 的分页返回对象；标准字段仍经 `FieldCandidateService` 按资源字段定义、权限和作用域解析，普通请求返回候选数组，`withMeta=1` 使用候选元数据契约。报表 `rows` 查询保留分页行为。
- 对派生数据的 finance ranking 显式加入类型化候选 provider；扫描并覆盖本次发现的所有 `listRows` 资源候选路径，没有删除 BOM 的 `listRows`。
- BOM 的事业部候选从租户作用域内的 `mps_order_allocations.division_id` 取真实稳定 ID，并解析组织名称；候选查询在设置 tenant RLS 上下文的事务内执行。候选被限于实际 allocation 行，不从全公司目录无条件暴露。
- 前端把响应视为未知类型并校验数组及候选字段；无效响应会显示错误与重试入口，不会把错误对象写入候选状态或继续 `.map()` 白屏。
- 没有修改 E10 BOM 同步、BOM 计算、统计口径或数据库结构；无 migration，也没有重新执行 BOM 全量同步。
- 保留当前生产 Web 中的 MPS 剩余数量修复：将生产 Web 基线 `99c3701` 合入发布分支后部署。

## 自动化验证

- API：候选数组/withMeta 契约、`rows` 分页仍有效、派生 finance ranking 候选 provider、BOM 稳定 division ID 与 tenant 上下文均有回归覆盖。公共 `src/common/filtering` 测试：8 suites、44 tests 全通过。
- Web：高级筛选收到错误分页对象时显示可重试错误；有效候选重试可正常显示。高级筛选与共享 KdosDataTable 回归 43/43 通过。
- Contracts：BOM 报表字段契约 2/2 通过。
- Contracts/API/Web typecheck、API/Web/Contracts build、受影响文件 ESLint 均通过。Web 构建有既存的大 chunk 非阻断提示。
- API/BOM/finance 相关回归此前 43/43 通过；公共 filtering suite 后续补齐资源注册夹具后达到 44/44。
- 自动化覆盖注册的各类资源与候选契约，但未执行用户列出的所有交互组合（多条件 AND/OR、导出联动、三视图逐项浏览等）。
- 用户权限和数据范围通过候选服务授权路径、BOM tenant RLS 代码与相关自动化检查覆盖；本次未用真实登录身份对生产数据逐项验收。

## 生产发布

- API Build SHA：`56fc0f8b80405c840a1c277ca4519543d45cf963`
- Web Build SHA：`56fc0f8b80405c840a1c277ca4519543d45cf963`
- 发布镜像：API `sha256:e49d4966eadb497431a2b74448dd39113593c0c621f573d1efc20f45ab21c853`；Web `sha256:c4a12a65e5515e3d067e2e5d9f12766ff7bfd6a1071b2b8b18a72b064607f55d`；Document Worker `sha256:08f9c1690e201ad56b9b82816124aa3b9b33fda5a9ed396d40a339479f5fe4ee`。
- API、Web、Document Worker、PostgreSQL 容器均为 `running / healthy`；`scripts/deploy.sh check` 报告仓库、Web、API SHA 一致，状态 `CONSISTENT`。
- 部署前 legacy DB、KDOS DB 和 uploads 已备份并校验；备份路径与 SHA256 见 [进度记录](./KDOS研发中心BOM报表高级筛选白屏修复进度.md)。无 migration。
- Chrome 生产验收：**未完成**。原因是没有有效登录态会话或获准的测试身份，且环境无法连接默认 Chrome profile 的 CDP。恢复条件：提供可复用的已登录 Chrome 会话，或配置获准的只读/测试身份后，按“研发中心 → BOM报表 → 订单BOM明细 → 高级筛选 → 承接事业部”完成交互验收，并检查筛选、清空、切换视图和控制台异常。

## GitHub

- 分支：`feat/rd-bom-sync-refactor-20261110`
- 修复提交：`8712aad`；保留生产 Web 基线合并：`6c33fd9`；最终测试与进度记录提交：`56fc0f8`。
- Push 成功，远端 SHA `56fc0f8b80405c840a1c277ca4519543d45cf963` 与本地一致；未 force push、未推送 main。
- 根工作区原 `perf/mps-three-tier-sync-20261107` 分支未修改；开发使用预先存在的独立干净 worktree。

## 交付状态

代码、自动化回归、发布、健康检查和 GitHub 同步已完成。由于生产 Chrome 登录态验收未执行，端到端交付验收仍待完成；在取得测试会话后，应继续按进度记录中的下一步执行，不能将 API 测试视作 Chrome 验收替代。

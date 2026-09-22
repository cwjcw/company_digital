# Codex 工作进度

## 任务

任务名称：KN-MPS-LIVE-003-02：plan-projections 第三次正式上线门禁

任务目标：依据第三次门禁要求，以最新生产备份完成隔离干跑、保护边界和一致性核验；全部 GO 条件成立后，仅开启 plan-projections 并完成两轮正式同步和线上复核。

当前状态：已完成（GO）

最后更新时间：2026-09-22

---

## 当前阶段

当前阶段：正式切换成功，线上验收完成

当前子任务：无。

---

## 已完成

- [x] 读取任务要求、项目规范、适用技能及上轮进度。
- [x] 确认开始 HEAD 为 bdb3946，原工作区干净。
- [x] 确认生产 API 健康，已包含 customer guard 和 inbound guard。
- [x] 确认六个初始同步开关符合门禁要求，plan-projections 保持关闭。
- [x] 新备份成功：2026-09-22 08:43:13，`data/backups/four_department_tracker_20260922_084313.backup`（316011590 字节，SHA256 bd49b05cd34d2ed4014afe442969771a90390197482254e62eeac885e9549e59）、`data/backups/kdos_20260922_084313.backup`（8155720 字节，SHA256 33cd873b38126c1e40c189e41498ced4335b04a417aa0c6f1166aae2187c753f）、`data/backups/uploads_20260922_084313.tar.gz`（38271 字节，SHA256 089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533）。
- [x] 记录生产 14 表基线、ERP 状态及客户统计；ERP SUCCESS，1271 订单行、1270 活动、8 空客户代码品项、2 个有效且已映射客户。
- [x] 新备份恢复至独立临时库，固化 14 表对照快照；真实 `plan-projections` 干跑 SUCCESS，96 allocations、96 monthly、20 group、59 inbound，空客户阻断 8、缺映射阻断 0、默认事业部 0。
- [x] 干跑拆分：allocation 新增 84/更新 12，monthly 新增 84/原有行变化 67（含入库重算），group 新增 1/更新 19；84 新记录均来自 2026A027396；12 既有分配更新来自 2026A027336（11）及 2026A027401（1）。
- [x] 合法范围九项一致性全部为 0，人工保护字段差异 0；历史冻结 monthly 8、group 2；八张下游保护表逐行差异全部为 0。
- [x] 2025A027103、2026A027319 历史 monthly/group 全部未更新；8 条空客户 allocation 均为 division=NULL 且 active 异常。
- [x] 动态入库 guard：临时库内分别增加非法与合法月计划的科加入库 1；非法月计划值/version/updated_at 均不变，合法月计划入库 +1 且欠数/完成率正确。
- [x] 针对性回归：5 套件 116 测试通过。
- [x] 补测 NULL、空串、纯空格客户代码，allocation 均保留且 division=NULL/异常 active；历史计划零变更。隔离库删除非法入库事实后，冻结月计划仍零变更；紧邻幂等同步四项写入 0。
- [x] 线上 1169 条周计划全部有 `execution_enabled=true` 包装任务，外协及中心外购内部工序误启数 0；补充 3 套件 31 测试通过。
- [x] 19 项 GO 条件逐项通过；再次读取生产六开关、ERP 状态和核心计数，均与干跑输入一致，准许仅开启 `plan-projections`。
- [x] 通过应用服务及审计，仅开启 `plan-projections`；首次正式同步 SUCCESS，日志 `01a0c698-0c4e-70f6-91df-cb4f55aff5e3`，count 271，metrics 与隔离干跑完全一致。
- [x] 正式同步后 14 表数量核验：allocation 1185→1269、monthly 1185→1269、group 102→103；八张下游表逐行哈希对照均为 0 差异；人工保护字段差异 0。
- [x] 正式同步后合法范围九项一致性全部 0，历史冻结 monthly 8、group 2；异常键 NULL 0、活动键重复 0，MISSING_CUSTOMER_CODE 9、INBOUND_EXCEEDS_DEMAND 1。
- [x] 第二轮正式同步 SUCCESS，日志 `01a0c699-6629-7b1e-a146-2d3586d9c134`，allocation/monthly/group/inbound 四项写入均为 0。
- [x] 两笔历史订单跨库逐行哈希对照：2025A027103 月计划 7、集团 1；2026A027319 月计划 5、集团 1；全部 0 差异，version/updated_at 无变化。
- [x] 开关变更有 `audit_logs` 记录 `b9211527-1653-4bca-bdee-f07b4dc24556`；最终六开关为 ERP=true、projection=true、inbound=false、shipping=false、weekly=false、execution=true。
- [x] API/Web/PostgreSQL healthy，`/api/v1/health`、`/api/docs`、`/api/openapi.json` 均 HTTP 200，包装启用缺失数 0。生产 API 镜像 `sha256:1e5cbb35294df7c153d6e5f96b24b4d0b263cc28cc73facac09a93e927bdd0a5` 含两项 guard。

---

## 正在进行

- [x] 完成健康检查、两订单历史计划跨库哈希对照及最终开关核验。

---

## 待完成

- [x] 在最新备份恢复的隔离库执行真实投影干跑并核验所有统计、一致性和保护边界。
- [x] 完成动态 guard 和生产包装数据检查。
- [x] 逐项核对 GO 条件并仅开启 plan-projections、执行两轮正式同步；待最后健康检查结束。
- [x] 更新最终进度和报告；没有修改业务代码或 Migration。

---

## 修改文件

- outputs/CODEX_PROGRESS.md

---

## 14 表基线与首次正式同步后

| 表 | 备份时 | 同步后 | 变化 |
|---|---:|---:|---:|
| mps_erp_order_lines | 1271 | 1271 | 0 |
| mps_order_allocations | 1185 | 1269 | +84 |
| mps_group_plans | 102 | 103 | +1 |
| mps_monthly_plans | 1185 | 1269 | +84 |
| mps_shipping_plans | 478 | 478 | 0 |
| mps_base_plans | 1169 | 1169 | 0 |
| mps_weekly_plans | 1169 | 1169 | 0 |
| mps_weekly_process_plans | 11690 | 11690 | 0 |
| mps_process_reports | 1021 | 1021 | 0 |
| mps_three_day_work_orders | 1169 | 1169 | 0 |
| mps_technical_reports | 1126 | 1126 | 0 |
| mps_material_reports | 2252 | 2252 | 0 |
| mps_outsourcing_reports | 631 | 631 | 0 |
| mps_data_exceptions | 117980 | 117980 | 0 |

核心表 `max(version)`：ERP 3→3、allocation 2→3、monthly 3→4、group 2→3；`max(updated_at)` 的具体值见本次生产核验记录。下游八表不只是数量不变，逐行哈希差异也全部为 0。

---

## 数据库 Migration

- 无

---

## 新增或修改测试

- 无；复用现有测试及隔离库门禁脚本。

---

## 已运行测试

测试名称：生产预检、隔离库真实干跑、九项一致性、保护字段/下游/历史冻结核验

结果：全部通过；干跑 SUCCESS，allocation 84 新增/12 更新，monthly 84 新增/12 投影更新（另 59 入库重算），group 1 新增/19 更新；九项一致性、人工保护字段、八张下游表逐行差异全部为 0。

测试名称：动态空客户及入库 guard、隔离幂等

结果：NULL/空串/空格均正确阻断；非法月计划在入库增加及删除后均不变，合法月计划正确重算；隔离幂等写入全 0。

测试名称：针对性 Jest 回归

结果：8 套件、147 测试通过；仅有本机 Node 22 低于项目声明 Node >=24 的既有 engine warning。

测试名称：两轮正式同步、生产一致性与健康检查

结果：首次 SUCCESS/count=271，第二次 SUCCESS/count=0；生产九项一致性全部 0，八张下游表逐行差异全部 0；三个服务 healthy，三个 HTTP 检查 200。

---

## 当前已知问题

- 保留既有业务数据异常：`INBOUND_EXCEEDS_DEMAND` 活动 1 条（2026C235004/99996364-1/1，首次创建于 2026-09-11）；本任务未修改该异常事实。`MISSING_CUSTOMER_CODE` 活动 9 条（8 条 allocation + 1 条历史 group），属预期阻断。

---

## 等待用户确认

- 无

---

## 下一步

1. 本任务已完成（GO）；不要在此任务继续下一 LIVE 阶段。
2. 最终报告路径：`outputs/CODEX_PROGRESS.md`；开始及结束 HEAD 均为 `bdb3946`，工作区只修改本文件，未提交。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、SKILL.md、本进度文件。
2. 执行 `git status` 和 `git diff --stat`，保留用户修改。
3. 从“下一步”的第一项未完成任务继续，不重复已完成工作。

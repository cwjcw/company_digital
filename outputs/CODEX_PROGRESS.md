# Codex 工作进度

## 任务

任务名称：KN-MPS-LIVE-003-02：plan-projections 第二次正式上线门禁

任务目标：在完整生产备份、当前生产代码真实 dry-run、数据一致性和四项回归全部通过后，正式开启并验证 `plan-projections`；其他三个下游同步继续关闭。

当前状态：NO-GO（已恢复 `plan-projections=false`，等待修复空客户历史月计划仍会被入库重算自动更新的问题）

最后更新时间：2026-09-20 09:43 +08:00

---

## 当前阶段

当前阶段：门禁结束

当前子任务：无；按任务要求发现代码缺陷后停止，不在本任务现场修复。

---

## 已完成

- [x] 开始 HEAD `f43a977`，开始工作区 clean；未 reset、未回退历史代码。
- [x] 确认 `30d8fa7` 是 customer guard 业务代码 commit，`f43a977` 是文档 commit；生产 API 镜像 `sha256:219e4410b353cd866118a0cd08ab143e3d686f88c6e6c823cbc27f3bfc2e5dea` 包含空客户异常键、月/集团主投影过滤和阻断 metrics。
- [x] 确认门禁前同步开关完全符合要求：`erp-orders=true`、`plan-projections=false`、`inbound-allocation=false`、`shipping-to-base=false`、`base-to-weekly=false`、`execution-rollup=true`。
- [x] 重新完成并校验生产备份（2026-09-20 09:29:53 +08）：
  - `data/backups/four_department_tracker_20260920_092953.backup`，313393333 bytes，SHA256 `27be765e06f1f0867f6124eaf895a960925427b8309ac0d67f9e1ca78e929a39`。
  - `data/backups/kdos_20260920_092953.backup`，8155720 bytes，SHA256 `008066695b04fe70dc673339a444931ceb7034e910139b2ad815087e4ee8e69c`。
  - `data/backups/uploads_20260920_092953.tar.gz`，38271 bytes，SHA256 `089222cfad078dc359b16a61911385c71a334fea89919de2906e350e3054e533`。
  - 两个 PostgreSQL 备份均通过 `pg_restore --list`，uploads 通过 `tar -tzf`。
- [x] 记录上线前 14 表基线：ERP 1186、allocation 1169、group 99、monthly 1169、shipping 478、base 1169、weekly 1169、weekly process 11690、process reports 589、three-day 1169、technical 1126、material 2252、outsourcing 631、exceptions 117971。
- [x] 最近 `erp-orders` 为 SUCCESS，active ERP 品项 1185；活动唯一订单品项 1184，有效客户 2、已映射 2、未映射 0、空客户品项 8。
- [x] 在临时恢复库 `kn_mps_live_003_02_gate2_20260920_092953` 使用当前生产镜像执行真实代码 dry-run：SUCCESS。
- [x] 首轮 dry-run：allocation insert 16/update 1168；monthly insert 16/update 126/inbound 176；group insert 3/update 97；空客户阻断 8、无映射阻断 0、默认事业部 0。
- [x] 紧邻第二轮 dry-run 完全幂等：allocation/monthly/group/inbound 全为 0。
- [x] 空客户当前数据样本在普通 dry-run 中未被更新；两单 allocation 均保留、事业部为空、异常激活，历史 monthly/group 未删除。
- [x] 临时库构造非空无映射客户，验证 allocation 保留且事业部为空、`MISSING_ALLOCATION_DIVISION` 激活、monthly/group 均为 0。
- [x] dry-run 一致性检查全部为 0：重复 allocation、非法 allocation 事业部、monthly 数量/事业部、group 数量/主责事业部、非科加入库污染、pending、completion、保护字段、下游表变化、NULL/重复 active exception key。
- [x] 定向回归 4 suites / 94 tests 全通过：weekly execution、异步报工/outbox、包装规则、customer guard；生产包装缺失/禁用数均为 0。
- [x] 曾在全部当前数据门禁通过后通过带审计的应用入口短暂开启同步；首轮正式同步 SUCCESS（log `01a0bc78-aa71-7912-9125-c93215513de1`）：sync_count 1610、allocation 1184、monthly 142、group 100、inbound 184、空客户阻断 8、无映射阻断 0、默认事业部 0。
- [x] 正式首轮 inbound 比备份 dry-run 多 8 已解释：备份后科加入库新增 10 行，其中 8 行命中月计划；空客户历史月计划实际触碰数为 0。
- [x] 正式第二轮完全幂等（log `01a0bc79-5050-74c1-b899-63c533554821`）：allocation/monthly/group/inbound 全为 0。
- [x] 正常新 ERP 样本 `2026A027400 / GFB315HT-1/1` 已形成 ERP → allocation → monthly → group 完整链路。
- [x] 最终代码级边界验证发现缺陷后，立即通过带审计应用入口恢复 `plan-projections=false`；其他同步开关未改变。

---

## 正在进行

- [ ] 无。

---

## 待完成

- [ ] 后续独立修复任务：给 `projectPlans()` 的两段月计划入库重算 SQL 增加与 customer guard 一致的合法投影范围，确保空客户/无映射客户的历史 monthly 永不被自动维护。
- [ ] 修复后新增回归：历史空客户 monthly 已存在且科加入库数量变化时，`inbound_recalculated=0`、monthly 版本/字段均不变。
- [ ] 修复、部署并重新执行完整上线门禁；本任务不得继续开启生产开关。

---

## 修改文件

- `outputs/CODEX_PROGRESS.md`（仅此文件；无业务代码修改）。

---

## 数据库 Migration

- 无。

---

## 新增或修改测试

- 无；本任务按规定不现场修复缺陷。

---

## 已运行测试

测试名称：目标 Jest 回归

结果：4 suites / 94 tests 全部通过。

测试名称：生产备份临时恢复库真实同步

结果：普通首轮成功、第二轮幂等成功；非空无映射链路成功；空客户入库变化边界复现缺陷。

测试名称：生产首轮与第二轮正式同步

结果：两轮均 SUCCESS；第二轮核心 metrics 全 0。发现潜在自动维护缺陷后已关闭开关。

---

## 当前已知问题

- 缺陷：`projectPlans()` 月计划 INSERT/UPDATE 已过滤空 `customer_code` 和无映射 allocation，但随后两段 `cumulative_inbound_quantity/pending_quantity/completion_rate` 重算未使用相同过滤条件。
- 触发条件：生产保留的空客户历史 monthly 后续对应科加入库数量发生变化（无入库变为有入库、数量变化或入库消失）。
- 临时库证据：将 `2026A027319 / GFB433KB-1/1` 科加入库从 10 改为 11 后，再跑真实同步得到 `inbound_recalculated=1`，该空客户 monthly 版本从 1 变 2、累计入库从 10 变 11。
- 风险：违反“历史空客户 monthly 保留但停止自动维护”，定时开启后未来入库变化可改写被保护记录。
- 生产影响：本次生产两轮同步没有触碰空客户历史 monthly；两个样本版本/更新时间保持旧值。开关已恢复 false，缺陷不会被定时触发。

---

## 等待用户确认

- 是否启动独立缺陷修复任务；本任务已按 NO-GO 结束。

---

## 下一步

1. 新任务修复入库重算的合法月计划范围，并补充上述边界回归。
2. 部署修复后，从新备份和新临时恢复库重新执行完整门禁。
3. 在新门禁 GO 前保持 `plan-projections=false`。

---

## 恢复执行说明

新的 Codex 会话开始后：

1. 读取当前适用的 AGENTS.md、`.agents/skills/kdos-form-platform/SKILL.md` 与本文件。
2. 执行 `git status`、`git diff --stat`，不得回退本次记录或用户修改。
3. 先确认生产 `plan-projections=false`，不得把本次已执行过两轮同步误认为正式 GO。
4. 按“当前已知问题”建立独立修复与回归；修复部署完成后重新从备份开始执行上线门禁。

# 主计划大屏 REV3 总控

当前任务：KDOS-MPS-DASHBOARD-REV3A-001。日期：2026-10-16（Asia/Shanghai）。
REV3-A起始HEAD、Web、API均d6e6e8ad8d6fa6b17db493196653314071dda69a，工作区干净。

| 阶段 | 范围 | 状态 |
|---|---|---|
| REV3-B | 在制订单进度 Demo | PASS |
| REV3-A | 待处理事项独立大屏 | IN_PROGRESS |
| REV3-C | PMC 综合驾驶舱 | NOT_STARTED |
| REV3-D | 集成及验收 | NOT_STARTED |

## REV3-B 人工验收

用户于2026-10-16明确确认 KDOS-MPS-ORDER-PROGRESS-REV3B-001：PASS。
真实多周计划场景已通过隔离PostgreSQL测试，后续取得真实样本时补充业务复核。这属于补充验证事项，不改变已确认的PASS。
人工验收记录已独立提交e806509并push github/main，与REV3-A代码提交分开。原功能提交bbefc6d、最终基线发布d6e6e8a；原始起点4ece1df/线上08f9195保留于B验收记录。

## REV3-A 范围与边界

新增 `/master-plan-gaps`，PMC中心 → 大屏报表 → 主计划大屏 → 待处理事项大屏。复用既有overview资源read/export/字段/CUSTOM scope，原querySql的同一gap_rows生成轻量count，清单和Excel复用原链路。9类定义、稳定关联键、REV2顶部筛选语义不变；已访问清单分页/排序/搜索独立保留。
原 `/master-plan-dashboard` 及已PASS的 `/master-plan-order-progress` 继续正常运行。不改业务数据、历史计划、报工、入库、6项flags和生产授权；不需要migration。3天工单窗口无正式规则，继续不展示。
结束状态必须WAITING_MANUAL_ACCEPTANCE，不自行PASS；交付后停止，不进入REV3-C/D。

恢复入口：`outputs/CODEX_PROGRESS.md`。
B指标及验收：`outputs/KDOS_MPS_ORDER_PROGRESS_METRICS.md`、`outputs/KDOS_MPS_ORDER_PROGRESS_DEMO_ACCEPTANCE.md`。
A定义与验收：`outputs/KDOS_MPS_GAP_AUDIT.md`、`outputs/KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md`、`outputs/KDOS_MPS_GAPS_REV3A_ACCEPTANCE.md`。

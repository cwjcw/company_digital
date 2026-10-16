# 主计划大屏 REV3 总控

任务：KDOS-MPS-ORDER-PROGRESS-REV3B-001。日期：2026-10-16（Asia/Shanghai）。
真实起始 HEAD：4ece1df8435ad4c329e1be1d22ca9625459905a4。线上应用：08f9195；差异仅上一轮 outputs 验收记录，工作区干净。

| 阶段 | 范围 | 状态 |
|---|---|---|
| REV3-B | 在制订单进度 Demo | IN_PROGRESS |
| REV3-A | 待处理事项独立大屏 | NOT_STARTED |
| REV3-C | PMC 综合驾驶舱 | NOT_STARTED |
| REV3-D | 集成及验收 | NOT_STARTED |

本轮只实施 B。原 `/master-plan-dashboard`、9类待处理事项和现有业务规则保留。最终须等待用户人工验收，不能自动 PASS；不自动继续其它阶段。

恢复入口：`outputs/CODEX_PROGRESS.md`。指标：`outputs/KDOS_MPS_ORDER_PROGRESS_METRICS.md`。验收：`outputs/KDOS_MPS_ORDER_PROGRESS_DEMO_ACCEPTANCE.md`。

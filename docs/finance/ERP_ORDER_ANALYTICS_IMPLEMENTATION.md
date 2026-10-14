# 财务中心 E10 销售订单统计

> **2026-10-14 新需求覆盖本文件既有实现描述**：用户要求财务订单模块日期时间统一显示为 `YYYY-MM-DD HH:MM:SS`，并已确认多品项预交货日取最早有效日期时间（MIN），不得因不同日期置空。本文件以下关于 `CONVERT(char(10),...,23)`、`::date`、多交期置空、日期留空冲突等属于此前上线实现现状/历史技术记录，**并非新目标口径**。具体变更要求以 `ERP_ORDER_ANALYTICS_SPEC.md` 与 `CODEX_ERP_ORDER_ANALYTICS_TASK.md` 最新章节为准。实际代码、迁移与生产数据是否完成整改必须经过 Codex 实施和独立验收；文档更新不代表已部署。

> **2026-10-14 增补的统计范围变更（尚待生产代码落实）**：用户要求不再显示统计大屏“待复核订单 N 张，金额 X 元，暂未纳入统计”横幅，保持待复核订单原本排除规则；另要求 E10 **指定结束订单不纳入月度数据、统计大屏、客户年度排名和年度/月度对比**。此前实现文档中“不按结束码过滤”的描述仅反映旧版运行逻辑，不能作为现行业务口径。真实代码值需通过只读核查订单头 `SALES_ORDER_DOC.[CLOSE]` 与交货计划 `SALES_ORDER_DOC_SD.[CLOSE]` 后确定，严禁把正常结束全部排除。详见 `ERP_ORDER_ANALYTICS_SPEC.md` §2.3 与 `CODEX_ERP_ORDER_ANALYTICS_TASK.md`。GitHub 已删除前端警告但尚未部署；后端指定结束排除尚未开发/验收。

本模块是财务专用只读模型，直接使用统一 `basic_code.MSSQLDatabase` 读取 E10；现有 ERP staging、正式订单、PMC、主计划、财务客户对应表和全部调度保持原状。无 Excel 上传或导入入口。只按 `ORDER_DATE >= 2025-01-01` 初始化，含当日，不按审核或结束码过滤。生产金额与实际数量只记录于受控本机验收报告，不进入 GitHub。

## 已核实来源

只读检查 `sys.columns`、`sys.extended_properties` 及 E10 自有 `CRM_VIEW_SALES_ORDER_DOC` / `销售订单` 定义。真实销售订单头/品项/交货计划表分别为 `SALES_ORDER_DOC` / `_D` / `_SD`。主键分别为 `SALES_ORDER_DOC_ID` / `SALES_ORDER_DOC_D_ID`，保留来源账套，按源 UUID 分页，不按 SQL Server UUID 的字典顺序在客户端推进。所有查询 READ COMMITTED，无源写入。源库没有单独的业务年月列，以订单日期生成规范 `YYYY-MM`，不套用创建/修改日期。本位币通过 `PARA_COMPANY.FUNCTION_CURRENCY_ID` 验证为 RMB；其他本位币会明确失败，不能冒称人民币。

别名：h=订单头，d=订单品项，sd=按品项聚合的交货计划，dt=DOC，e=EMPLOYEE，a=ADMIN_UNIT，c=CUSTOMER，i=ITEM，cu=CURRENCY，u=UNIT，t=TAX。

| 中文名称（原顺序） | 已核实 SQL 表列/表达式 | API 属性 |
| --- | --- | --- |
| 单据类型 | `dt.DOC_NAME` | `docType` |
| 业务员姓名 | `e.EMPLOYEE_NAME` | `salesperson` |
| 客户编号 | `c.CUSTOMER_CODE` | `customerCode` |
| 年月 | `CONVERT(char(7),h.ORDER_DATE,120)` | `yearMonth` |
| 订单日期 | `CONVERT(char(10),h.ORDER_DATE,23)` | `orderDate` |
| 单号 | `h.DOC_NO` | `orderNo` |
| 销售部门名称 | `a.ADMIN_UNIT_NAME` | `salesDepartment` |
| 预交货日 | `CONVERT(char(10),d.PLAN_DELIVERY_DATE,23)` | `deliveryDate` |
| 币种 | `cu.CURRENCY_CODE` | `currency` |
| 汇率 | `h.EXCHANGE_RATE` | `exchangeRate` |
| 序号 | `d.SequenceNumber` | `sequence` |
| 品号 | `i.ITEM_CODE` | `itemCode` |
| 品名 | `d.ITEM_DESCRIPTION` | `itemName` |
| 业务数量 | `d.BUSINESS_QTY` | `businessQty` |
| 客户单号 | `h.CUSTOMER_ORDER_NO` | `customerOrderNo` |
| 备注-业务 | `h.REMARK1` | `businessRemark` |
| 含税 | `h.TAX_INCLUDED` | `taxIncluded` |
| 计价数量 | `d.PRICE_QTY` | `priceQty` |
| 计价单位 | `u.UNIT_NAME` | `priceUnit` |
| 已交业务数量 | `sd.DELIVERED_BUSINESS_QTY` | `deliveredBusinessQty` |
| 已交计价数量 | `sd.DELIVERED_PRICE_QTY` | `deliveredPriceQty` |
| 结束码 | `sd.[CLOSE]` | `closeCode` |
| 已结算计价数量 | `d.SETTLEMENT_PRICE_QTY` | `settlementPriceQty` |
| 单价 | `d.PRICE` | `price` |
| 金额 | `d.AMOUNT` | `amount` |
| 税种名称 | `t.TAX_NAME` | `taxName` |
| 税率 | `d.TAX_RATE` | `taxRate` |
| 原币未税金额 | `d.AMT_UNINCLUDE_TAX_OC` | `originalNet` |
| 原币税额 | `d.TAX_OC` | `originalTax` |
| 本币未税金额 | `d.AMT_UNINCLUDE_TAX_BC` | `localNet` |
| 本币税额 | `d.TAX_BC` | `localTax` |
| 结算状态 | `d.SETTLEMENT_CLOSE` | `settlementStatus` |
| 审核 | `h.ApproveStatus` | `approved` |
| 本币合计金额 | `d.AMT_UNINCLUDE_TAX_BC+d.TAX_BC` | `localGross` |

Join 固定为 h.DOC_ID→dt.DOC_ID、h.Owner_Emp→e.EMPLOYEE_ID、h.Owner_Dept→a.ADMIN_UNIT_ID、h.CUSTOMER_ID→c.CUSTOMER_BUSINESS_ID、d.ITEM_ID→i.ITEM_BUSINESS_ID、h.CURRENCY_ID→cu.CURRENCY_ID、d.PRICE_UNIT_ID→u.UNIT_ID、d.TAX_ID→t.TAX_ID。品名使用 E10 品项快照 ITEM_DESCRIPTION，避免主档改名重写原订单语义。sd 的已交业务/计价数量 SUM；结束码只有实际交货计划一致时返回原码，冲突显示并隔离，无交货计划保留 NULL。交货计划多条不会放大金额。

## 数据与异常

`finance_e10_lines` 是财务源品项读模型，不是另一套权威订单。`finance_e10_raw` 展示34列；`finance_e10_orders_all` 按租户、E10账套、来源订单 UUID 聚合；`finance_e10_monthly` 是可验收的订单级9列视图。分类始终 JOIN `finance_customer_mappings` 的租户+完整客户编号，不向该表写入、不按前缀/ERP部门/PMC推断。

金额使用 Decimal / PostgreSQL numeric；订单含税金额 SUM 品项本币未税+税额并保留到分，不重算汇率。空分类保留 NULL，在报表中显示待分类，仍计入总额；分类修订立即影响历史报表。零和负金额保留，负金额进入异常复核。用户2026-10-14明确确认：同单多个预交货日时保留整单金额纳入统计，订单级预交货日NULL，页面/异常日志/大屏明确标记冲突，Excel原9列表头保持且该日期留空。客户、年月、单号、订单日期、非空客户单号冲突，重复序号/单号、源缺失/交货计划缺失仍明确列入异常并暂不纳入月度统计；报表展示暂缓订单数及金额，不任取首行。无品项订单头在读取批次来源覆盖中保留数量，不虚构品项或0金额订单。

## 手动刷新与恢复

系统导出页的“刷新E10数据”是显式 Application Command，支持全量、增量和失败后“继续读取”。无周期任务、新定时器或自动刷新轮询 ERP。页面只轮询已请求的批次状态。

全量读取包含初始化历史和全部主档显示值；增量按头/品项/交货计划 LastModifiedDate 及两分钟重叠窗口筛选影响订单，重读该单所有品项以重算金额。财务映射不需要ERP刷新。ERP客户/人员/品名等主档显示值改名如未使订单来源修改日期变化，应手动全量刷新；增量不擅自把源消失判作取消，后续全量只标记缺失并留存。

500行源页持久化到 `finance_e10_pages`，同时保存 UUID/date 游标、计数和批次。完整读取后先按年度核对来源独立 COUNT/SUM，再在一事务中发布所有页、写入变化前后审计并完成批次。重复读取不增加订单或品项、不改变未变化记录的业务版本。发布成功清除本批临时页，游标/计数/源汇总/审计保留。失败及服务重启保留已发布数据和断点；恢复会重新核实源总额，若源已变化导致不能勾稽，选择全量重试。READ COMMITTED 是读取观察，不能宣称 ERP 历史一致性快照。

同租户唯一 RUNNING 批次 + advisory lock 防并发。重启将中断批次标为失败，不能伪装仍在读取。只允许完整源字段、全部更新范围及 refresh/update 权限执行；异常明细限财务/系统管理员，受限用户不能从源统计旁路读取隐藏金额。

## 页面、权限及接口

资源：`finance-e10-lines`（系统导出，update 动作展示为刷新E10数据）、`finance-e10-monthly`（月度数据）、`finance-e10-dashboard`（统计大屏）、`finance-e10-ranking`（大屏中的客户年度排名）。复用现有权限组/管理员/租户 RLS/公共表格和字段权限。月度表显示与默认导出严格9列，另有不打印、不导出的业务员集合筛选维度；客户排名还须满足大屏的数据范围和相应字段权限，不能利用聚合接口绕过源权限。源记录表全部 FORCE RLS，派生视图 security_invoker。

- `GET /api/v1/table-filters/rows?resource=...`、候选/筛选/排序：平台统一入口；排名使用平台扩展的聚合 listRows provider。
- `POST /api/v1/finance/e10-orders/refresh`：`{mode: FULL|INCREMENTAL, resumeId?: UUID}`；返回受控批次 ID，异步读取。
- `GET /api/v1/finance/e10-orders/runs`：授权批次；普通完整范围人员只能查看自己的批次，管理员可查看本租户。
- `GET /api/v1/finance/e10-orders/exceptions`：管理员异常复核（不提供业务数据上传/写入）。
- `POST /api/v1/finance/e10-orders/dashboard`：所选年度/月份/日期/客户/事业部/内外销/业务员；单个源快照计算分组、趋势、矩阵、KPI。
- `POST /api/v1/finance/e10-orders/ranking`：同源条件、分页/搜索/类型化筛选/排序及前10/20/全部客户。
- Excel 导出使用原平台 `table-exports`，继承字段、操作和数据范围及全部已应用条件。大型源允许最多20万行并使用平台 streaming XLSX writer，其他资源默认8万行上限不变。财务模板导出将来源NULL保留为空单元格，数值使用数据库/适配器精确十进制字符串，不经公共呈现格式的四位小数截断或JavaScript浮点转换。

大屏严格保留模板表头、年合计/合计，空月补0；元/万元只改变呈现。公共 KdosChart 增加可选数据点击回调，图表与排名/交叉表下钻传递年度、月份、日期、业务员、客户及分类条件。

## 部署、回滚与验证

迁移 `FinanceE10Analytics1722920089000` 只新增财务读模型/临时页/批次和视图；`FinanceE10DeliveryDateConflicts1722920090000` 按用户最新确认调整交期冲突视图，不修改已应用的旧迁移。按标准 backup → TypeORM/KDOS迁移 → deploy all → health/version → 线上真实 E10初始化/金额勾稽/下载和浏览器验收。不安装systemd/n8n任务、不变更ERP任务。回滚保留新财务数据和审计，使用之前保留的应用镜像；down 主动拒绝删除财务历史。

验证入口：财务单元/表头测试、`scripts/test-finance-orders-postgres.cjs` 的隔离 PostgreSQL真实Command/权限/导出/幂等/异常/恢复测试、`scripts/test-finance-postgres.cjs` 的客户表及完整fresh迁移回归、财务页面及公共图表 Vitest、`finance-orders-ui.spec.ts` 的真实Chrome合成角色/导航/图表/移动布局验证。生产验收报告写 `outputs/FINANCE_E10_ORDER_ANALYTICS_ACCEPTANCE.md`（本机保留，财务数据不得推送）。

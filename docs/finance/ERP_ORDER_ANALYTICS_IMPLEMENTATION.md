# 财务中心 E10 销售订单统计

> 当前口径更新（2026-10-20）：月度数据现为订单×发生月份15列，月度/大屏/排名/Excel和日报统一接单发生额，旧原始订单月份余额口径仅保留内部有效余额。以下原始阶段需求按历史保留；现行合同以[月度发生额说明](../finance-order-monthly-movements.md)为准，不再调查历史完整性，也不回退已完成的品项指定结束和业务资格规则。


> **2026-10-14 新需求覆盖本文件既有实现描述**：用户要求财务订单模块日期时间统一显示为 `YYYY-MM-DD HH:MM:SS`，并已确认多品项预交货日取最早有效日期时间（MIN），不得因不同日期置空。本文件以下关于 `CONVERT(char(10),...,23)`、`::date`、多交期置空、日期留空冲突等属于此前上线实现现状/历史技术记录，**并非新目标口径**。具体变更要求以 `ERP_ORDER_ANALYTICS_SPEC.md` 与 `CODEX_ERP_ORDER_ANALYTICS_TASK.md` 最新章节为准。实际代码、迁移与生产数据是否完成整改必须经过 Codex 实施和独立验收；文档更新不代表已部署。

> **2026-10-14 增补的统计范围变更（尚待生产代码落实）**：用户要求不再显示统计大屏“待复核订单 N 张，金额 X 元，暂未纳入统计”横幅，保持待复核订单原本排除规则；另要求 E10 **指定结束订单不纳入月度数据、统计大屏、客户年度排名和年度/月度对比**。此前实现文档中“不按结束码过滤”的描述仅反映旧版运行逻辑，不能作为现行业务口径。真实代码值需通过只读核查订单头 `SALES_ORDER_DOC.[CLOSE]` 与交货计划 `SALES_ORDER_DOC_SD.[CLOSE]` 后确定，严禁把正常结束全部排除。详见 `ERP_ORDER_ANALYTICS_SPEC.md` §2.3 与 `CODEX_ERP_ORDER_ANALYTICS_TASK.md`。GitHub 已删除前端警告但尚未部署；后端指定结束排除已于2026-10-19完成本地修复和隔离回归；生产部署/历史刷新状态见本机本轮交付记录。

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

金额使用 Decimal / PostgreSQL numeric；订单含税金额 SUM 品项本币未税+税额并保留到分，不重算汇率。空分类保留 NULL，在报表中显示待分类，仍计入总额；分类修订立即影响历史报表。零和负金额保留，负金额进入异常复核。用户2026-10-14最新确认：订单级预交货日取所有非空有效品项日期MIN，仅全部为空时NULL；多交期提示已取最早日期，月度列表/筛选/9列Excel使用同一最早日期。财务DATE字段以YYYY-MM-DD文本返回，避免数据库驱动Date对象经UTC序列化显示前一天。品项原始日期、订单金额/订单数量及所有大屏金额不变。客户、年月、单号、订单日期、非空客户单号冲突，重复序号/单号、源缺失/交货计划缺失仍明确列入异常并暂不纳入月度统计；报表展示暂缓订单数及金额，不任取首行。无品项订单头在读取批次来源覆盖中保留数量，不虚构品项或0金额订单。

## 手动刷新与恢复

系统导出页的“刷新E10数据”是显式 Application Command，支持全量、增量和失败后“继续读取”。无周期任务、新定时器或自动刷新轮询 ERP。页面只轮询已请求的批次状态。

全量读取包含初始化历史和全部主档显示值；增量按头/品项/交货计划 LastModifiedDate 及两分钟重叠窗口筛选影响订单，重读该单所有品项以重算金额。财务映射不需要ERP刷新。ERP客户/人员/品名等主档显示值改名如未使订单来源修改日期变化，应手动全量刷新。2026-10-22起，增量还读取自2025年以来的稳定订单/品项UUID存在性清单；它不依赖LastModifiedDate，在按年度订单数、行数、全局行身份唯一性及安全降幅完成独立核验后，才把确认消失的来源行标为`source_missing`。连接或清单不完整时不发布；恢复出现的旧身份定向重读并复用原行。该技术失效不创建删除月的金额事件。

500行源页持久化到 `finance_e10_pages`，存在性清单以1000行页暂存到`finance_e10_presence_pages`，同时保存 UUID/date 游标、计数和批次。完整读取后先按年度核对来源独立 COUNT/SUM，再核对存在性年度订单/品项数和全局唯一性，最后在一事务中发布业务页、缺失/恢复状态和审计。重复读取不增加订单或品项、不改变未变化记录的业务版本或`updated_at`。发布成功清除两类临时页，游标/计数/源汇总/审计保留。失败及服务重启保留已发布数据和断点；恢复会重新读取完整存在性清单并核实源总额，若源已变化导致不能勾稽，选择全量重试。READ COMMITTED 是读取观察，不能宣称 ERP 历史一致性快照。

同租户唯一 RUNNING 批次 + advisory lock 防并发。重启将中断批次标为失败，不能伪装仍在读取。只允许完整源字段、全部更新范围及 refresh/update 权限执行；异常明细限财务/系统管理员，受限用户不能从源统计旁路读取隐藏金额。

## 页面、权限及接口

资源：`finance-e10-lines`（系统导出，update 动作展示为刷新E10数据）、`finance-e10-monthly`（月度数据）、`finance-e10-dashboard`（统计大屏）、`finance-e10-ranking`（大屏中的客户年度排名）。复用现有权限组/管理员/租户 RLS/公共表格和字段权限。月度表显示与默认导出严格9列，另有不打印、不导出的业务员集合筛选维度；客户排名还须满足大屏的数据范围和相应字段权限，不能利用聚合接口绕过源权限。源记录表全部 FORCE RLS，派生视图 security_invoker。

- `GET /api/v1/table-filters/rows?resource=...`、候选/筛选/排序：平台统一入口；排名使用平台扩展的聚合 listRows provider。
- `POST /api/v1/finance/e10-orders/refresh`：`{mode: FULL|INCREMENTAL, resumeId?: UUID}`；返回受控批次 ID，异步读取。
- `GET /api/v1/finance/e10-orders/runs`：授权批次；普通完整范围人员只能查看自己的批次，管理员可查看本租户。
- `GET /api/v1/finance/e10-orders/exceptions`：管理员异常复核（不提供业务数据上传/写入）。
- `POST /api/v1/finance/e10-orders/dashboard`：所选年度/月份/日期/客户/事业部/内外销/业务员；单个源快照计算分组、趋势、矩阵、KPI。
- `POST /api/v1/finance/e10-orders/ranking`：同源条件、分页/搜索/类型化筛选/排序及前10/20/全部客户。
- Excel 导出使用原平台 `table-exports`，继承字段、操作和数据范围及全部已应用条件。大型源允许最多20万行并使用平台 streaming XLSX writer，其他资源默认8万行上限不变。财务模板导出将来源NULL保留为空单元格，数值使用数据库/适配器精确十进制字符串，不经公共呈现格式的四位小数截断或JavaScript浮点转换。系统导出和月度数据均导出“创建时间/更新时间”，按Asia/Shanghai呈现。

大屏严格保留模板表头、年合计/合计，空月补0；元/万元只改变呈现。公共 KdosChart 增加可选数据点击回调，图表与排名/交叉表下钻传递年度、月份、日期、业务员、客户及分类条件。

## 部署、回滚与验证

迁移 `FinanceE10Analytics1722920089000` 只新增财务读模型/临时页/批次和视图；`FinanceE10DeliveryDateConflicts1722920090000` 记录此前日期冲突政策；最新 `FinanceE10EarliestDeliveryDate1722920091000` 只将订单视图预交货日改为MIN，依赖视图即时重算既有订单，不刷新E10或改源记录，不修改已应用的旧迁移。按标准 backup → TypeORM/KDOS迁移 → deploy all → health/version → 线上真实 E10初始化/金额勾稽/下载和浏览器验收。不安装systemd/n8n任务、不变更ERP任务。回滚保留新财务数据和审计，使用之前保留的应用镜像；down 主动拒绝删除财务历史。

验证入口：财务单元/表头测试、`scripts/test-finance-orders-postgres.cjs` 的隔离 PostgreSQL真实Command/权限/导出/幂等/异常/恢复测试、`scripts/test-finance-postgres.cjs` 的客户表及完整fresh迁移回归、财务页面及公共图表 Vitest、`finance-orders-ui.spec.ts` 的真实Chrome合成角色/导航/图表/移动布局验证。生产验收报告写 `outputs/FINANCE_E10_ORDER_ANALYTICS_ACCEPTANCE.md`（本机保留，财务数据不得推送）。

`FinanceE10SourcePresenceAndTimestamps1722920105000`是前向迁移：原始物理行继续保留；正常系统导出隐藏`source_missing`，订单/资格/金额派生视图只聚合当前存在品项，因此部分品项删除不会误排整单，完全删除订单不进入有效统计。系统导出时间直接来自`finance_e10_lines.created_at/updated_at`。月度行的创建时间取组成该“订单×发生月份”行的最早持久化来源行/变更事件创建时间，更新时间取来源行、变更事件和当前客户分类的最晚持久化更新时间；不使用视图查询时钟，历史无法还原的时间不虚构。


## 2026-10-19：订单头指定结束过滤

本轮来源已确认：`dbo.SALES_ORDER_DOC.[CLOSE]`（订单头）0未结束、1指定结束、2正常结束；原34列中的`closeCode`仍来自`SALES_ORDER_DOC_SD.[CLOSE]`，两者不可混用。E10只读适配器额外读取内部`headerCloseCode`（nvarchar文本/NULL），不在采集WHERE中排除任何状态，完整原始品项、金额与34列表头保留。新的采集页缺少订单头状态键时拒绝发布并要求全量重读；发布前还检查全部暂存页，避免升级前失败批次的旧页通过断点续读混入不完整状态；明确NULL与未知码按既有口径处理。

新迁移`FinanceE10SpecifiedClose1722920095000`只重建同一`finance_e10_monthly`派生视图：保留原冲突/重复/缺失/问题排除条件，按tenant+source_database+source_order_id匹配原始行，NOT EXISTS任一`headerCloseCode='1'`，以此排除整单，绝不只扣某个品项。0/2/NULL不因结束状态被排除；其它既有数据质量规则继续适用。`finance_e10_orders_all`和原始行保留，不重写金额/日期公式；同一monthly关系供月度数据、大屏各维度、排名及其平台Excel导出消费。

审核口径差异已先向用户报告：标准SQL有`ApproveStatus='Y'`，现有财务采集/统计无此过滤。本轮保留审核Y/N/V等既有范围；标准SQL另有G%客户排除，与本轮指定结束无关，也不改变当前财务范围。禁止修改外部标准SQL或ERP源库。

历史处理使用已授权的Finance FULL Application Command，自2025-01-01读取内部头状态后，视图即时重新计算；未来头/品项/交货计划变更的原增量逻辑重读影响订单全部品项。原先无头状态的历史行在补齐前仍按旧规则，不把未知误判为指定结束。正式核算必须在完整刷新成功之后记录指定结束数量/金额，原始金额、指定结束、其它待复核和有效金额分互斥集合勾稽；正常结束单独核验未被状态过滤误删。

真实财务数量/金额/品项、独立源SQL对账和下载结果仅保存在权限受限、Git忽略的`data/finance-header-close-20261019/`，公共文档只记录规则与合成测试。迁移up/down只改派生视图，不删除/覆盖ERP、原始品项或审计；回退到旧统计口径须明确操作，不恢复覆盖数据库。无新增调度、生产权限或同步flags变更。


## 2026-10-19：用户澄清后的品项级指定结束规则（取代仅订单头政策）

订单头 `SALES_ORDER_DOC.CLOSE=1` 排除整单；交货计划 `SALES_ORDER_DOC_SD.CLOSE=1` 只排除其关联的稳定 `source_line_id` 品项，其余品项正常统计。按品项ID处理，不能仅按品号合并，也不能因部分品项指定结束把整单删去。一个品项有多条交货计划时，内部 `hasSpecifiedCloseSchedule` 标志记录是否存在码1，避免原展示字段“冲突”掩盖指定结束。原始34列/金额/全部品项照常保留；新标志必须为布尔值，旧暂存页缺失时原子拒绝发布并要求FULL。

96号迁移仅替换 `finance_e10_monthly`，金额、行数、负数/零值、最早预交日由保留品项汇总。订单稳定id及既有客户/日期冲突、重复、来源缺失规则继续来自原 `finance_e10_orders_all`；被排除品项的结束码冲突不再阻止同单其他正常品项，剩余品项本身存在异常仍不入统计。原始和全单诊断视图不变。月度、大屏、客户排名、Excel继续复用同一关系。down回到95仅头规则，绝不删除源品项。

已真实执行外部标准 `sales_order.sql`、`销售订单手工查看.sql` 和销售出货标准SQL核对；它们分别使用头状态与出库状态，不能替代交货计划状态。外部文件均不修改，审核Y/N/V与客户G%范围仍按原财务实现，不擅自扩展；源只读鼎捷E10，不读用友T+。上线以原正式FULL补齐全部内部标志后重新核算，真实金额只在受限本机验收，不提交公共Git。

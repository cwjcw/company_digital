# 旧主计划资产清单

本清单固定 KDOS 重构前必须保留的 Planning UI、字段、Excel 契约和业务规则。源码依据为 `packages/shared/src/index.ts`、`apps/web/src/App.tsx`、`apps/api/src/domain.service.ts`、`apps/api/src/plan.service.ts` 和 `apps/api/src/import.service.ts`。

## 字段总览

- Web 月度计划字段：97 个。
- Excel 月度计划字段：93 个。
- Web 比 Excel 增加：`itemStatus`，以及毛坯、烤漆/电镀、组装&包装三个里程碑工序拆分后的独立数量/计算状态字段。
- 审计显示列另有创建时间、最后修改时间、修改人，不计入 97 个业务字段。
- 默认最小宽度 52/68，未单独配置的业务列宽 82；表格支持用户拖动调整列宽。

| # | 字段代码 | 中文名 | 第一层表头 | 类型 | 宽度 | 编辑 | 固定 | 字典 |
|---:|---|---|---|---|---:|---|---|---|
| 1 | `sequence` | 序号 | 基础字段 | decimal | 52 | 否 | 是 |  |
| 2 | `orderNumber` | 订单号 | 基础字段 | text | 104 | 否 | 是 |  |
| 3 | `orderDate` | 下单日期 | 基础字段 | date | 72 | 否 | 否 |  |
| 4 | `customerDueDate` | 客户要求交期 | 基础字段 | date | 76 | 是 | 否 |  |
| 5 | `reviewDueDate` | 产前评审交期 | 基础字段 | date | 76 | 是 | 否 |  |
| 6 | `exceptionDueDate` | 异常后二次交期 | 基础字段 | date | 76 | 是 | 否 |  |
| 7 | `exceptionDeliveryMethod` | 异常交期交货方式 | 基础字段 | dictionary | 76 | 是 | 否 | deliveryMethod |
| 8 | `containerDate` | 装柜日期 | 基础字段 | date | 72 | 是 | 否 |  |
| 9 | `modelAge` | 新旧款 | 基础字段 | dictionary | 52 | 是 | 否 | modelAge |
| 10 | `itemNumber` | 品号 | 基础字段 | text | 90 | 否 | 是 |  |
| 11 | `relationKey` | 关联信息 | 基础字段 | text | 132 | 否 | 是 |  |
| 12 | `itemName` | 品名 | 基础字段 | text | 100 | 否 | 是 |  |
| 13 | `image` | 简图 | 基础字段 | image | 54 | 是 | 否 |  |
| 14 | `productAttribute` | 产品属性 | 基础字段 | dictionary | 60 | 是 | 否 | productAttribute |
| 15 | `surfaceNature` | 表面性质 | 基础字段 | dictionary | 60 | 是 | 否 | surfaceNature |
| 16 | `specialItem` | 特别项 | 基础字段 | dictionary | 52 | 是 | 否 | specialItem |
| 17 | `productionQuantity` | 订单需求数量 | 基础字段 | decimal | 72 | 是 | 否 |  |
| 18 | `historicalInboundQuantity` | 历史入库数据 | 基础字段 | decimal | 72 | 是 | 否 |  |
| 19 | `todayInboundQuantity` | 当天入库数 | 基础字段 | decimal | 68 | 是 | 否 |  |
| 20 | `balanceQuantity` | 订单欠数 | 基础字段 | decimal | 68 | 否 | 否 |  |
| 21 | `handlingMethod` | 制作方式 | 基础字段 | dictionary | 68 | 是 | 否 | handlingMethod |
| 22 | `itemStatus` | 品号状态 | 基础字段 | text | 68 | 否 | 否 |  |
| 23 | `outsourcing.method` | 外协方式 | 外协相关 | dictionary | 82 | 是 | 否 | outsourcingMethod |
| 24 | `outsourcing.supplier` | 外协供应商 | 外协相关 | dictionary | 82 | 是 | 否 | supplier |
| 25 | `outsourcing.dueDate` | 外协交期 | 外协相关 | date | 82 | 是 | 否 |  |
| 26 | `outsourcing.exceptionDueDate` | 外协实际交期 | 外协相关 | date | 82 | 是 | 否 |  |
| 27 | `processes.drawingBom.requiredDays` | 所需天数 | 图纸&BOM | decimal | 82 | 是 | 否 |  |
| 28 | `processes.drawingBom.dueDate` | 交期 | 图纸&BOM | date | 82 | 是 | 否 |  |
| 29 | `processes.drawingBom.status` | 状态/数量 | 图纸&BOM | text | 82 | 是 | 否 |  |
| 30 | `processes.drawingBom.exception` | 异常 | 图纸&BOM | text | 82 | 是 | 否 |  |
| 31 | `processes.metalMain.requiredDays` | 所需天数 | 五金主材 | decimal | 82 | 是 | 否 |  |
| 32 | `processes.metalMain.dueDate` | 交期 | 五金主材 | date | 82 | 是 | 否 |  |
| 33 | `processes.metalMain.status` | 状态/数量 | 五金主材 | text | 82 | 是 | 否 |  |
| 34 | `processes.metalMain.exception` | 异常 | 五金主材 | text | 82 | 是 | 否 |  |
| 35 | `processes.woodMain.requiredDays` | 所需天数 | 木作主材 | decimal | 82 | 是 | 否 |  |
| 36 | `processes.woodMain.dueDate` | 交期 | 木作主材 | date | 82 | 是 | 否 |  |
| 37 | `processes.woodMain.status` | 状态/数量 | 木作主材 | text | 82 | 是 | 否 |  |
| 38 | `processes.woodMain.exception` | 异常 | 木作主材 | text | 82 | 是 | 否 |  |
| 39 | `processes.frontParts.requiredDays` | 所需天数 | 前道配件 | decimal | 82 | 是 | 否 |  |
| 40 | `processes.frontParts.dueDate` | 交期 | 前道配件 | date | 82 | 是 | 否 |  |
| 41 | `processes.frontParts.status` | 状态 | 前道配件 | text | 82 | 是 | 否 |  |
| 42 | `processes.frontParts.exception` | 异常 | 前道配件 | text | 82 | 是 | 否 |  |
| 43 | `processes.machining.requiredDays` | 所需天数 | 机加 | decimal | 82 | 是 | 否 |  |
| 44 | `processes.machining.dueDate` | 交期 | 机加 | date | 82 | 是 | 否 |  |
| 45 | `processes.machining.status` | 状态 | 机加 | text | 82 | 是 | 否 |  |
| 46 | `processes.machining.exception` | 异常 | 机加 | text | 82 | 是 | 否 |  |
| 47 | `processes.welding.requiredDays` | 所需天数 | 焊接/点焊 | decimal | 82 | 是 | 否 |  |
| 48 | `processes.welding.dueDate` | 交期 | 焊接/点焊 | date | 82 | 是 | 否 |  |
| 49 | `processes.welding.status` | 状态 | 焊接/点焊 | text | 82 | 是 | 否 |  |
| 50 | `processes.welding.exception` | 异常 | 焊接/点焊 | text | 82 | 是 | 否 |  |
| 51 | `processes.grinding.requiredDays` | 所需天数 | 研磨 | decimal | 82 | 是 | 否 |  |
| 52 | `processes.grinding.dueDate` | 交期 | 研磨 | date | 82 | 是 | 否 |  |
| 53 | `processes.grinding.status` | 状态 | 研磨 | text | 82 | 是 | 否 |  |
| 54 | `processes.grinding.exception` | 异常 | 研磨 | text | 82 | 是 | 否 |  |
| 55 | `processes.blank.requiredDays` | 所需天数 | 毛坯 | decimal | 82 | 是 | 否 |  |
| 56 | `processes.blank.dueDate` | 交期 | 毛坯 | date | 82 | 是 | 否 |  |
| 57 | `processes.blank.quantity` | 数量 | 毛坯 | decimal | 82 | 是 | 否 |  |
| 58 | `processes.blank.status` | 状态 | 毛坯 | text | 82 | 否 | 否 |  |
| 59 | `processes.blank.exception` | 异常 | 毛坯 | text | 82 | 是 | 否 |  |
| 60 | `processes.woodwork.requiredDays` | 所需天数 | 木作 | decimal | 82 | 是 | 否 |  |
| 61 | `processes.woodwork.dueDate` | 交期 | 木作 | date | 82 | 是 | 否 |  |
| 62 | `processes.woodwork.status` | 状态 | 木作 | text | 82 | 是 | 否 |  |
| 63 | `processes.woodwork.exception` | 异常 | 木作 | text | 82 | 是 | 否 |  |
| 64 | `processes.painting.requiredDays` | 所需天数 | 油漆 | decimal | 82 | 是 | 否 |  |
| 65 | `processes.painting.dueDate` | 交期 | 油漆 | date | 82 | 是 | 否 |  |
| 66 | `processes.painting.status` | 状态 | 油漆 | text | 82 | 是 | 否 |  |
| 67 | `processes.painting.exception` | 异常 | 油漆 | text | 82 | 是 | 否 |  |
| 68 | `processes.acrylic.requiredDays` | 所需天数 | 亚克力 | decimal | 82 | 是 | 否 |  |
| 69 | `processes.acrylic.dueDate` | 交期 | 亚克力 | date | 82 | 是 | 否 |  |
| 70 | `processes.acrylic.status` | 状态 | 亚克力 | text | 82 | 是 | 否 |  |
| 71 | `processes.acrylic.exception` | 异常 | 亚克力 | text | 82 | 是 | 否 |  |
| 72 | `processes.bakingPlating.requiredDays` | 所需天数 | 烤漆/电镀 | decimal | 82 | 是 | 否 |  |
| 73 | `processes.bakingPlating.dueDate` | 交期 | 烤漆/电镀 | date | 82 | 是 | 否 |  |
| 74 | `processes.bakingPlating.quantity` | 数量 | 烤漆/电镀 | decimal | 82 | 是 | 否 |  |
| 75 | `processes.bakingPlating.status` | 状态 | 烤漆/电镀 | text | 82 | 否 | 否 |  |
| 76 | `processes.bakingPlating.exception` | 异常 | 烤漆/电镀 | text | 82 | 是 | 否 |  |
| 77 | `processes.rearPackingParts.requiredDays` | 所需天数 | 后道包材&配件 | decimal | 82 | 是 | 否 |  |
| 78 | `processes.rearPackingParts.dueDate` | 交期 | 后道包材&配件 | date | 82 | 是 | 否 |  |
| 79 | `processes.rearPackingParts.status` | 状态 | 后道包材&配件 | text | 82 | 是 | 否 |  |
| 80 | `processes.rearPackingParts.exception` | 异常 | 后道包材&配件 | text | 82 | 是 | 否 |  |
| 81 | `processes.assemblyPacking.requiredDays` | 所需天数 | 组装&包装 | decimal | 82 | 是 | 否 |  |
| 82 | `processes.assemblyPacking.dueDate` | 交期 | 组装&包装 | date | 82 | 是 | 否 |  |
| 83 | `processes.assemblyPacking.quantity` | 数量 | 组装&包装 | decimal | 82 | 是 | 否 |  |
| 84 | `processes.assemblyPacking.status` | 状态 | 组装&包装 | text | 82 | 否 | 否 |  |
| 85 | `processes.assemblyPacking.exception` | 异常 | 组装&包装 | text | 82 | 是 | 否 |  |
| 86 | `planPage` | 对应计划页数 | 基础字段 | decimal | 82 | 是 | 否 |  |
| 87 | `orderException` | 订单异常信息 | 基础字段 | text | 82 | 是 | 否 |  |
| 88 | `inspection` | 验货 | 基础字段 | text | 82 | 是 | 否 |  |
| 89 | `inspectionQuantity` | 验货数量 | 基础字段 | decimal | 82 | 是 | 否 |  |
| 90 | `remark` | 备注 | 基础字段 | text | 82 | 是 | 否 |  |
| 91 | `orderWeeks` | 订单周数 | 基础字段 | decimal | 82 | 是 | 否 |  |
| 92 | `month` | 年月 | 基础字段 | text | 82 | 否 | 否 |  |
| 93 | `unitPrice` | 单价 | 基础字段 | decimal | 82 | 是 | 否 |  |
| 94 | `inboundAmount` | 订单入库金额 | 基础字段 | decimal | 82 | 否 | 否 |  |
| 95 | `balanceAmount` | 订单欠数金额 | 基础字段 | decimal | 82 | 否 | 否 |  |
| 96 | `customer` | 客户 | 基础字段 | text | 82 | 是 | 否 |  |
| 97 | `division` | 所属事业部 | 基础字段 | dictionary | 82 | 是 | 否 | division |

## 工序和表头结构

14 个工序按顺序为：图纸&BOM、五金主材、木作主材、前道配件、机加、焊接/点焊、研磨、毛坯、木作、油漆、亚克力、烤漆/电镀、后道包材&配件、组装&包装。

工序作为第一层分组表头，字段中文名作为第二层表头。为控制超宽表，工序进一步组合成可折叠阶段：前道、五金、木作、后道；每个阶段默认只显示代表工序，展开后显示完整工序。外协字段使用“外协相关”分组。普通字段没有业务分组；审计信息单独作为分组追加。

## 编辑器、Renderer 和 Formatter

- text/date/decimal：AG Grid 默认文本编辑器；仅在“编辑模式”开启且字段 registry 标记 editable 时可编辑。
- dictionary：`agSelectCellEditor`，选项来自字典 API 或供应商 API。
- image：点击单元格打开图片上传弹窗，单元格显示“上传”或“n 张”。
- decimal：`valueParser` 把空串转为 `null`，其他输入转数值；服务端再次规范化并使用 Decimal 计算。
- date：显示格式 `MM-DD`，服务端存储/传输 `YYYY-MM-DD`。
- status：完成、进行中、即将延期、延期对应绿色、蓝色、黄色、红色 class。
- 审计时间：显示 `YYYY-MM-DD HH:mm:ss`。

## 筛选和交互规则

- 所有列可排序和调整宽度；页面使用自定义筛选抽屉，不启用 AG Grid 内置列 filter。
- 快速筛选：事业部、订单号、品号、品号状态、客户要求交期范围、产前评审交期范围、异常后二次交期范围。
- 自定义筛选支持文本包含、字典匹配、数字和日期范围。
- 默认隐藏 `relationKey`，用户字段显示设置按账号保存在 localStorage。
- 前三类关键标识列固定；选择框固定为最左列。
- 支持横向虚拟滚动、双层/多层表头、单元格文本选择、行多选和批量调整月份。
- 失焦自动保存，也可显式“保存并退出编辑模式”；并发冲突提示刷新后重试。

## 颜色和状态规则

- 工序组使用 a/b 两种淡色交替；折叠阶段保持统一色调。
- 工序状态：`已完成/完成` 绿色，`进行中` 蓝色，`即将延期` 黄色，`延期` 红色。
- 里程碑工序状态由完成数量、生产数量和交期计算；逾期判断优先于入库完成判断。
- 品号状态由欠数和工序状态聚合：延期优先，其次即将延期、完成、进行中。
- 交期颜色基线业务约定：完成率大于等于 100% 为绿色；等于当天且未完成为黄色；早于当天且未完成为红色。

## 权限规则

- 列级 editable 只是 UI 基线；后端以权限和数据范围再次校验。
- 权限键格式基线为 `resource:field:action`，支持 `*`、资源动作和字段动作。
- 月度计划资源键为 `monthly-plan`；读取、更新、导入、导出分别检查相应动作。
- 数据范围来自用户角色的事业部或组织范围。
- 更新必须携带 `expectedVersion`；版本不一致返回 HTTP 409。

## Excel 字段映射

- `excelMonthlyPlanColumns` 是 93 列导入/导出契约，顺序由 shared package 固定并有测试断言。
- Excel 与 Web 基础字段代码一致；Excel 中里程碑工序的“状态/数量”在 Web 中拆成可编辑数量和只读计算状态。
- 双层 Excel 表头由“工序/外协分组 + 子字段”组成，普通字段纵向合并。
- 导入流程：上传 → 解析双层表头 → 类型归一化 → 校验 → 预览 → 用户确认 → 事务写入。
- 业务键为月份 + 订单 + 品号；重复导入更新既有行。

## 计算规则

后端 `DomainService` 是旧系统权威计算源：

- 欠数 = 生产数量 - 历史入库数量 - 当天入库数量。
- 入库金额 = 入库数量 × 单价。
- 欠数金额 = 欠数 × 单价。
- 完成率 = 已完成数量 / 总数量；总数为 0 时为 `null`。
- 负欠数保留并产生数据质量警告。
- 金额、数量和比例使用 `decimal.js`，数据库使用 `numeric`。
- 前端只负责格式化和状态 class，不应重新实现数量与财务算法。

## 迁移验收底线

重构后必须至少保留 97 个 Web 字段、93 列 Excel 契约、14 个工序、双层/折叠表头、固定列、横向虚拟滚动、字段显示、筛选、图片、单元格编辑、批量操作、状态颜色、乐观锁和 Decimal 计算。任何字段删除或语义变化必须在最终迁移报告中单独说明。

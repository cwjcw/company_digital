# PMC研发进度 Phase 5.1 验收报告

当前状态：已完成。**Phase 5.1：PASS**。23项完成标准全部满足。
最终更新时间：2026-10-07 21:30（Asia/Shanghai）。
提交：`7c320bcecd863126b8792275f34284654839d6d6`。业务时区：Asia/Shanghai。

## 1. 页面调整

PMC → 报表 → 研发进度增加“图表看板 / 明细报表”两个二级Tab，默认图表看板。图表包含六KPI、研发环节指标和七状态分布；大明细表、标准分页/搜索/高级筛选/列筛选/字段偏好/Excel/订单Drawer/品项详情在明细。已访问明细表保留标准查询和分页，两个Tab共享已应用条件。主体没有重复标题、副标题，页面纵向滚动、表格横向滚动及sticky保留。Drawer沿用嵌入滚动例外。

## 2. 图表筛选

事业部、客户、研发状态、设计BOM状态、工艺路线状态、未完成都为下拉，均提供全部。客户/事业部来自现有权限受控`/table-filters/candidates`接口，支持服务器搜索；多候选提示搜索。真实事业部候选复用组织路径“凯南 / 事业四部”，不硬编码候选值。明细额外保留订单号、品项编码、品项名称输入框。

## 3. 日期标准与业务口径

日期仍筛选既有`orderDate`（下单日期），只转换为包含式`orderDateFrom/orderDateTo`，不传UI模式给后端算法。

| 模式 | 输入 | API包含式区间 |
|---|---|---|
| 按日 | 2026-10-05 | 2026-10-05～2026-10-05 |
| 按月 | 2026-09 | 2026-09-01～2026-09-30 |
| 按年 | 2026 | 2026-01-01～2026-12-31 |
| 自定义 | 2026-09-15～2026-10-05 | 2026-09-15～2026-10-05 |

日/月/年使用对应DatePicker，只有自定义用RangePicker。URL保留period、periodValue（自定义为逗号分隔两日）和tab，刷新恢复；兼容Phase5完整from/to链接。默认与重置均按日+上海昨天，清空所有条件不会转为全部/空日期/今天。先用Intl提取上海自然日，再操作日历字符串；不通过UTC转换选择器日期。TZ=UTC实际运行边界测试：2026-10-06T16:01Z→上海10-07→昨天10-06；15:59:59Z→昨天10-05。

当前无过去7天趋势图，不额外新增图表；Skill正式定义未来趋势为昨天向前7个完整自然日、不含今天，不改变高级筛选编译器其他动态日期语义。

## 4. 明细与导出实现

一行=一个销售订单品项。默认100条，50/100/200/500/1000继续沿用公共KdosDataTable。标准搜索、FilterGroup、列筛选、排序及核心日期/事业部/客户/状态/未完成全部继承到标准Excel。使用已验证的`/table-exports/pmc-rd-progress`和同一个QueryService.list，不新增查询/Excel框架。

提交查询立即更新已应用快照，再持久化URL；Tab读取最新已应用条件，避免Router异步提交期间快速切Tab或立即导出使用旧条件。字段表单同步不通过resetFields重新挂载控件。技术字段和页面虚拟操作列不导出。

## 5. 真实下载核对

已在LAN正式部署环境实际下载.xlsx并用已有ExcelJS读取工作簿，不依赖Chrome网络response.body。下列计数在最终生产15项套件中重新核对通过。

| 条件 | 页面每页/实际页面条数 | 全部匹配 | Excel记录 |
|---|---:|---:|---:|
| 2026全年 + 只看未完成 | 100 / 100 | 5361 | 5361 |
| 事业四部 + 2026全年 + 未开始 + 只看未完成 | 100 / 3 | 3 | 3 |

文件名`pmc-rd-progress.xlsx`。首行中文业务表头，无sourceOrderLineId、内部ID/hash/tenantId。组合文件逐行核对事业部、中文研发状态和下单日期。客户实际搜索、选择、请求参数也通过真实Chrome。

## 6. Skill更新

实际生效文件：`.agents/skills/kdos-form-platform/SKILL.md`。

- 新增Dashboard/Report段落，合并维度下拉、四周期/默认及重置昨天/上海日历/趋势定义、KPI与条件式图表联动、集中中文命名。
- 修改既有导出条款，覆盖标准明细报表、默认.xlsx、全部已应用条件与全部匹配记录、排除技术字段；没有重复创建导出规范。
- 明确页面是否拆Tab由实际业务决定；没有加入“所有报表必须两个Tab”的全局标准。
- 保留原重复标题、compact、页面纵向滚动/表格横向滚动、sticky和权限规则。
- Skill quick_validate通过。现有KdosChart无点击事件接口，保留KPI/状态快捷筛选联动，没有为本页改造基础图表组件。

## 7. 自动化测试

- 全量Web回归：31文件/229项通过；最终本页修改后专项23/23复测通过，公共组件无改动。
- 全量API：87 suites/738项通过；1项既有跳过。PMC专项5 suites/73项通过；其他workspace通过。
- TZ=UTC上海边界测试通过。
- 全workspace typecheck/lint/build通过；最终Web lint通过（既有Portal warning1项），git diff --check通过。
- 覆盖权限/字段裁剪、四周期、非法日期/闰月、默认和重置、Tab保持、组合导出、分页回首页、API错误、Drawer等。

## 8. Chrome验收与凭据

Chrome预验收15/15通过（2.2分钟），包括真实登录/菜单/当天默认、四历史样本、订单Drawer、全年跨页Excel、全部周期实际选择、重置/刷新、动态客户、事业部/状态/未完成完整导出、1920/1366和sticky/分页、匿名401和实际账号字段裁剪。正式环境默认昨天2026-10-06：订单67、品项323、未完成177、总体完成率40.00%，七状态总数等于品项数。最终LAN正式环境Chrome **15/15通过（1.4分钟）**，入口http://192.168.1.249:15172/pmc/reports/rd-progress；覆盖需求六个生产场景，外加四周期、四历史样本、权限及表格回归。

E2E登录/权限验证：通过（最终生产验收）。凭据只在运行时从用户指定安全文件读取；未修改密码/账号权限，未写入源码、进度、报告或Git。测试禁用截图/video/trace/页面身份快照，不保存storageState。

## 9. 构建、备份、部署

标准备份已完成（pg_restore --list通过）：

| 备份 | SHA256 |
|---|---|
| data/backups/four_department_tracker_20261007_205113.backup | 6d6ad910f7b5502a3113b6b70e1ea45a2a6998888cee1b0cc720ec7117059bea |
| data/backups/kdos_20261007_205113.backup | 8f3e6d59339b54433b28cd89511b1822ea8e217a2aa97914604e0c21601ee509 |
| data/backups/uploads_20261007_205113.tar.gz | b02ccb3b322c497e6181ca830fd8670171eaa2e6619699c0182a25984da50310 |

实际执行`./scripts/deploy.sh all`，按统一版本规则构建/更新API与Web；API业务代码无改动。最终部署已成功，Repository/API/Web均为7c320bcecd863126b8792275f34284654839d6d6，PostgreSQL/API/Web均healthy；标准healthcheck与版本check通过。最终生产Chrome15/15通过。不重建PostgreSQL，不改Compose、env或账号权限，不执行迁移、seed、ERP同步或业务数据写入。

## 10. 修改文件

| 文件 | 内容 |
|---|---|
| apps/web/src/modules/pmc-rd-progress/PmcRdProgressPage.tsx | Tab、共享下拉/周期、立即应用及URL同步、明细延迟显示 |
| apps/web/src/modules/pmc-rd-progress/ReportFilterControls.tsx（新增） | 现有候选API受控Select与四周期选择器 |
| apps/web/src/modules/pmc-rd-progress/rd-progress.period.ts（新增） | 上海默认日期、日历边界和URL周期归一化 |
| apps/web/src/modules/pmc-rd-progress/PmcRdProgressPage.spec.tsx | 23项页面/边界回归 |
| apps/web/src/modules/pmc-rd-progress/rd-progress.css | 紧凑响应式日期栏、明细及Tab布局 |
| apps/web/e2e/pmc-rd-progress.real.spec.ts | 扩展现有真实账号Chrome suite为15项，实际XLSX核对 |
| .agents/skills/kdos-form-platform/SKILL.md | 合并四类正式标准 |
| docs/pmc-rd-progress.md | Phase5.1交互/API日期/URL说明 |

另更新主要进度`outputs/CODEX_PROGRESS.md`、本报告和3份不含凭据的业务验收JSON。无数据库migration、无新增npm依赖、无新增API；Calculator、E10 Reader、FULL/INCREMENTAL、水位、候选定义和主计划同步均未改动。保留全部历史outputs；只提交上述8个源码/测试/文档/Skill文件，无push。

## 11. 人工验收步骤

1. 打开当前正式入口`http://192.168.1.249:15172/pmc/reports/rd-progress`，使用原账号。默认图表看板，应显示按日/昨天；没有大明细表或主体重复标题。
2. 下单日期选择按月/2026-09、查询，确认URL区间09-01～09-30和KPI/状态分布刷新；按年/2026同样检查01-01～12-31。
3. 选择自定义09-01～10-07后查询；开始日键盘输入可Tab切到结束日、Enter提交，或直接用日历。刷新后日期/模式保留。
4. 选择事业四部、只看未完成及所需日期后查询，进入明细报表；条件不丢失。检查订单号/品项文本查找、公共快速搜索、高级/列筛选、分页/字段显示/列宽及订单Drawer/品项详情。
5. 选择2026全年+只看未完成，明细默认100条，点击导出；Excel应含全部匹配数据而非100条。增加事业部/状态后再导出，检查每行事业部、中文状态、下单日期及无技术字段。
6. 返回图表点击已完成/未完成/异常KPI并马上进入明细，确认筛选正确、第一页；快速查询后立即导出也必须继承最新条件。
7. 向下滚动明细，确认表头仍可见、页面仅一个纵向滚动，宽列横向滚动对齐；检查1920/1366视口。
8. 点击重置或空表清空筛选，应恢复按日/上海昨天，并清除维度及标准搜索/高级筛选。

## 12. 已知限制

没有新增业务限制。事业部未映射数据保持Phase4原状态，不猜测/修复映射。外部HTTPS入口在本机仍存在既有TLS/直连问题；本次验收使用同一当前运行系统的localhost15172及LAN入口，未修改网络配置。保留既有Portal lint warning、Node宿主engine提示、Vite大bundle提示及API1项skip，Docker构建使用Node24。KdosChart无原生点击联动事件，本轮保留现有KPI及状态按钮联动。

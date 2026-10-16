# PMC综合驾驶舱 REV3-C 交付验收

任务：KDOS-MPS-DASHBOARD-REV3C-001。日期：2026-10-16（Asia/Shanghai）。

| 阶段 | 状态 |
|---|---|
| REV3-A 待处理事项 | PASS（用户人工验收2026-10-16） |
| REV3-B 在制订单进度 | PASS（用户人工验收2026-10-16） |
| REV3-C PMC综合驾驶舱 | WAITING_MANUAL_ACCEPTANCE |
| REV3-D | NOT_STARTED |

本记录区分自动化验收、生产只读对账与用户人工验收。C尚未人工PASS；本轮结束后停止，不启动D。

## 版本与入口

起始Repository/Web/API均`50a518741dd77f9c476a5a1aa4e1f93af2babbc9`，工作区干净。A人工验收文档已独立提交`1b4d9a4`并推送github/main，未与C代码混合。C功能提交`7b85aaf546ca6ef0407b512614b6bb84eaa349ea`（28文件）已推送github/main并正式部署；最终记录提交亦按同一all/check发布，结束SHA以交付回复、build-info/health及私有final-state.json的实时一致版本为准，避免文档自引用SHA。

- 驾驶舱：`http://192.168.1.249:15172/master-plan-dashboard`，保留原URL；PMC中心 → 大屏报表 → 主计划大屏 → PMC综合驾驶舱。
- 独立报表：`http://192.168.1.249:15172/master-plan-reports`；PMC中心 → 报表 → PMC分析明细报表。
- A/B原路径：`/master-plan-gaps`、`/master-plan-order-progress`。不新增重复驾驶舱。

## 页面与保留能力

顶部沿用事业部、客户、远程多选订单/品号、订单/交付日期、清空、刷新；驾驶舱默认不限日期。紧凑9KPI、订单互斥完成分布、计划数量Bar、事业部数量/比例/风险切换、10工序进度、正式工序状态分布、准备状态、4类图纸/主材/外协、7天实际报工、4风险摘要和事业部汇总；原10行工序汇总折叠保留。复用KdosChart/KdosDataTable，首页不请求三张明细或完整9类Tabs，无重复主体标题/用途副标题。

三张正式报表复用原MpsDashboardDetailTable及服务端table/export，独立分页（默认100）、搜索、排序、局部条件与导出；顶部scope共同作用。事业部汇总、三报表和原工序汇总共5种Excel复用原正式服务，完整匹配范围，不受当前页影响，英文文件名、中文业务值、无UUID。真实验证审计使用显式stub保证READ ONLY；正式用户导出仍走Application审计。

跨屏入口真实导航到正式A/B/报表。仅白名单filters与9类gap定位；同一日期contract校验，非法条件显示错误并停止请求，身份/权限/SQL/重定向不传递。B直开及重置仍是上海昨天，从驾驶舱携带NONE时不限日期；原未完成开关保持。目标仍独立授权。

## 正式来源与安全边界

完整定义见[指标合同](KDOS_MPS_PMC_COCKPIT_METRICS.md)。集团订单按主责事业部，执行按承接事业部，不混合求和。订单整体完成率保持集团完成量SUM/需求量SUM；周计划下达率=正式下达量SUM/月计划需求SUM；入库率=累计入库SUM/月计划需求SUM；工序进度=实际报工SUM/正式月计划需求SUM。分母0显示—，不平均行百分比、不截断105%。延期/异常及辅助状态使用原正式定义，状态不由进度反推；状态图单位月计划条数。7日趋势为上海昨天向前7个完整自然日的production_date实际SUM，顶部业务日期不改变时间轴。4风险摘要用对应正式gap数量并标明基础/月计划粒度。无虚假齐套率/产能/不适用或3天缺口。

新`/dashboard/summary`复用同一querySql，省略不用的风险明细投影；原聚合/API/差集/导出与scope不重写。页面/报表继续同一`mps-overview-dashboard`read/export/field/data scope；B仍自身资源。read∩export后端强制、tenant/CUSTOM事业部UUID隔离、依赖字段裁剪、无权值不推断0；OWN仍created_by。没有新增授权资源、生产权限初始化或授权迁移。

## 自动化验证

| 范围 | 结果 |
|---|---|
| API full | 108套，1012通过，33默认外部集成跳过；相关PG另启用 |
| Dashboard HTTP及Dashboard/B PostgreSQL | 3套31通过，TEMP隔离及rollback，不写生产业务数据 |
| Contracts | 29通过，跨屏白名单/日期/类型/直接默认与携带NONE/非法参数覆盖 |
| Web full | 54套407通过（含B相同query展开定向回归） |
| typecheck / lint / build | 通过；仅既有Portal FastRefresh警告和Vite大chunk提示 |
| 本地Chrome | 驾驶舱/报表13、A7、B9，共29通过 |
| 部署后Chrome | 29/29通过（正式Web构建，合成API拦截；独立于真实只读核验） |
| migration check | 93/93，无新增migration |

Chrome合成响应覆盖1366/1440/1920、旧URL/导航/单一标题、9KPI/图表、顶部筛选/日期/刷新/清空、10工序顺序/105%/状态独立/10色/七日tooltip、4辅助状态、风险到精确A分类、携带条件到B、三报表独立分页/排序/搜索/导出、事业部及工序汇总Excel、目标拒绝/无export、加载/空值/隐藏字段/失败。Web与API补充tenant/CUSTOM/field/read403/export403。合成响应通过不等于生产数据指标已核验，后者单列如下。

全量Web首轮暴露B初始化展开竞态：相同初始query的250ms回调无条件折叠已展开订单。修复仅在页码/页大小/排序真正变化时折叠；显式定向回归确保相同query保留展开、真实翻页折叠，原B8项和Chrome9项回归通过。该调整不改B指标、日期默认或权限。

## 真实生产只读对账与性能

全局/事业部/订单/交付月四组均与起始Service非风险汇总完全一致；各组9项核心KPI、事业部计划指标、10工序需求/实际/比率、14类正式状态、原始七日报工均一致。全局包含4个真实事业部，筛选后按真实获权数据呈现。共56组状态分布、120个工序数值、280个趋势点核验；每组10条canonical样本，共40条。所有验证在REPEATABLE READ READ ONLY事务执行，不创建测试任务/报工/入库。真实原始行、Excel、日志和对账脚本仅保留受限且Git忽略的`data/pmc-cockpit-rev3c/`，不入Git。

验证方法：当前summary与起始50a5187原Service的非风险字段全量相等；授权原始集团/月/周/工序任务及4种报工一次读取后独立核算数量/比率、正式状态优先级、延期与人工异常；另抽样执行原canonical virtual SQL；原始报工SUM和7日×10工序逐点核验。逐行全范围virtual表达式验证曾触发15s/60s探针超时，改成以上有界验证，不调整生产Service的15s超时或公式。

| 只读scope | summary实际耗时 | canonical 10条样本耗时 |
|---|---:|---:|
| 全局 | 1363ms | 491ms |
| 事业部 | 730ms | 475ms |
| 订单 | 145ms | 182ms |
| 交付月2026-10 | 341ms | 302ms |

真实Excel完整行数：事业部4、计划待完善111、工序执行21060、风险异常207、工序汇总10；分别约1399/309/6542/515/1299ms。页99请求仍导出全部匹配，不仅当前页；全部无UUID。CUSTOM事业部、空tenant、字段隐藏、read403与4类正式导出无export403验证通过。耗时是单次本机实际样本，不是并发负载承诺。

## 备份、部署与变更范围

标准备份`20261016_141858`：两库custom备份及uploads，pg_restore目录验证、3项SHA256均通过。迁移93/93，无需结构变更/生产授权初始化，NO-GO条件未触发。标准`./scripts/deploy.sh all`与`check`通过，Repository=Web=API=7b85aaf，STATUS=CONSISTENT；Web/API/PostgreSQL/document-worker四服务healthy，Swagger/OpenAPI及页面健康通过，原PostgreSQL容器保留、Dispatcher active。四页面200，summary/count/table/export匿名401；有登录但无权限的403由HTTP/PG及运行Service单独覆盖。运行API容器实际summary全局/事业部/订单/交付月分别1360/802/178/345ms，与正式dashboard非风险结果完全相等；9类summary/gap-counts/detail total一致，noRead403通过。最终记录版本按相同标准all/check与最终smoke核对，不改变功能源码。

修改范围：API summary投影/Controller/HTTP及PG测试；Web原驾驶舱/共享toolbar/抽取原Drawer/独立报表/跨屏适配/A与B可选初始化及B同query回归/CSS/App/Chrome与Web测试；Contracts summary类型/导航白名单及测试；integration-guide/runbook、总控/本进度/C指标及本验收、B指标头部与已确认PASS一致。无业务写接口/表结构/配置/迁移/同步调度改动。

## 并发业务活动说明

起始只读基线11:39至部署前，12张表中8张count/version哈希一致；4张有正常并发活动，不能宣称业务库全程静止。审计证实14:15:41 Web订单分配导入100行、11:46:59至14:02:55 Web实际报工新增3条；11:46:59的一条任务状态随报工更新；ERP来源行4条于14:16:40更新，既有已启用同步链路仍正常运行，另有ERP投影审计。以上均早于C功能提交/部署，本任务验证只读、不调用同步或写入接口，不覆盖/回滚用户及既有任务的数据。备份14:18:58已覆盖上述业务变化。

生产授权/角色/管理员/数据范围哈希、6flags开关及周期、migration/schema/约束均与11:39起点一致。6flags既有5启用、plan-projections禁用，保持原状。后续发布核验另与部署前快照比较；正常在线变化按审计事实单列，不假报全部哈希相同。

## 部署后实际缺口与最终边界

运行容器9类数量依次：未进入出货计划1347、未进入基础计划0、未进入周计划0、计划待完善111、未开始报工1022、未入库950、未完成入库82、延期未完成197、生产异常10。对应清单total一致，不改变A定义；驾驶舱4风险摘要直接用相应gap数与单位。

功能部署后12张业务表count/version哈希、授权/6flags、migration/schema/约束与部署前快照完全一致；起始至部署前的正常并发差异已单列。无本任务业务写入、无同步手工触发/调度或flag变更、无新增migration/生产授权修改。备份与只读证据保留本机受限目录，工作区仅提交任务文件，GitHub普通push，无force。

交付材料已齐，C工程实施完成；用户尚未进行REV3-C真实人工验收，因此C严格保持WAITING_MANUAL_ACCEPTANCE。A/B保持PASS；D保持NOT_STARTED，本任务结束后停止。

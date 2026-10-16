# KDOS-MPS-DASHBOARD-REV3A-001 验收记录

当前状态：IN_PROGRESS（发布核验尚待完成，不自行判PASS）。
日期：2026-10-16，Asia/Shanghai。

## 交付范围

新页面 `/master-plan-gaps`，PMC中心 → 大屏报表 → 主计划大屏 → 待处理事项大屏。保留 `/master-plan-dashboard` 与已经用户PASS的 `/master-plan-order-progress`。本轮只实施REV3-A，不启动REV3-C/D。

REV3-B人工验收日期2026-10-16、结果PASS，三份记录独立提交e806509并推送github/main。真实多周计划场景已通过隔离PostgreSQL测试；后续真实样本业务复核仅为补充验证，不改变PASS。

## 业务、组件及权限

- 9类差集公式、正式稳定父ID和原REV2 Scope保持不变。未进周计划保留正式“已具备条件”条件；计划待完善不作为生产异常。3天工单窗口无正式规则，继续不展示。
- 顶部原远程事业部/客户/订单号/品号及订单日期/交付日期筛选；继承REV2首次和清空不限日期的明确业务要求。支持清空、手动刷新，候选限量远程搜索，前端不拉全量计算。
- 新轻量 `/api/v1/master-plan-system/dashboard/gap-counts` 只返回gaps/visibleFields/generatedAt，从原querySql同一gap_rows SELECT计数；只使用顶部条件，不叠加局部清单搜索/分页/排序。原summary接口保持兼容。
- 复用mpsDashboardGaps、MpsDashboardGapList、MpsDashboardDetailTable及原正式export服务。KPI切Tab；Tab首次访问才请求，保留各自服务端分页/搜索/排序，顶部条件变化重置清单。默认100，50/100/200/500/1000；Excel为本类全部匹配记录，不受页码影响。
- 安全复用mps-overview-dashboard的理由：新页只是原9类事实的独立视图，没有新增事实/字段/数据源；read、export、字段依赖、tenant、CUSTOM事业部、read∩export及Application导出审计全部沿原链路。路由、菜单和页面检查同一read，后端独立拒绝越权。未新增权限资源，未更改生产授权，不改变OWN=created_by。
- 统一KdosDataTable compact、sticky、页面单纵向滚动和表内横向滚动；列宽沿平台localStorage tenant/user/resource/viewKey/fieldKey偏好，不新增列宽系统。独立大屏不重复主体标题，无CRUD/同步能力；聚合大屏无打印，清单仅保留既有正式导出能力。

## 真实数据只读验证

在同一REPEATABLE READ READ ONLY事务中读取当前生产数据，明确服务层测试actor，不伪造生产登录令牌。UI Chrome使用合成响应，与真实数据库证据分开。真实XLSX用原导出Service生成并读回，Application审计明确替换为测试stub，避免写生产假审计；正式下载仍记录正式导出审计。敏感行、标识、日志和脚本仅存忽略目录data/mps-gaps-rev3a，不入Git。

| 类别 | 不限顶部日期 KPI / total / Excel行数 |
|---|---:|
| 未进入出货计划 | 1347 / 1347 / 1347 |
| 未进入基础计划 | 0 / 0 / 0 |
| 未进入周计划（已具备条件） | 0 / 0 / 0 |
| 计划待完善 | 111 / 111 / 111 |
| 未开始报工 | 1022 / 1022 / 1022 |
| 未入库 | 950 / 950 / 950 |
| 未完成入库 | 82 / 82 / 82 |
| 延期未完成 | 197 / 197 / 197 |
| 生产异常 | 10 / 10 / 10 |

以上为2026-10-16验证时快照，不固定未来业务数量。不限日期、订单日期2026-10、交付日期2026-10三组×9类共27次count/summary/detail一致；真实CUSTOM事业部9类一致、空tenant9类均0、无read及9类无export拒绝。全部Excel中文表头/业务值、无UUID，英文文件名由HTTP及Chrome独立验证。

当前真实轻量数量耗时约1053ms（不限）、177ms（订单日期月）、370ms（交付日期月），未改索引或全局数据库参数。没有持久化第二套聚合事实。

## 测试与门禁

- API全量108套1011项通过，32项默认外部集成skip；相关新旧PostgreSQL专项单独启用18项全部通过，不把skip计通过。新增count字段裁剪、read403、9类export403/英文文件名；PG验证同scope count/detail、稳定父ID、CUSTOM/tenant、局部搜索独立、55条TEMP数据两页50+5、9类XLSX全部匹配。
- Contracts25项通过，锁定原9类名称/权限字段依赖/导出key，无3天新增类型。
- 新页Web6项及旧页专项21项通过；最终单线程全量52套400项全部通过。首轮全量399通过1项既有研发页偶发选择时序失败，单独27项复测通过；没有改动或删除该测试。
- Chrome本地三个页面28项全部通过，新页7、旧综合12、已PASS Demo9；包括1366/1920、compact/sticky/单纵向滚动、按需加载/分页/排序/搜索/顶部Scope、9类下载、权限、空错加载。首轮两个新测试定位问题修正后通过，未改变业务断言。
- 全仓typecheck/lint/build通过，仅既有Portal FastRefresh与Vite大chunk提示。宿主migration:show使用127.0.0.1:15433检查93/93已应用，无新增migration。首次误用容器内postgres域名的宿主检查失败已纠正，不改运行配置。
- 12业务表记录数/version哈希、6项flags、权限/角色/管理员授权哈希、schema/约束及migration台账与本轮起始基线一致。
- 标准备份20261016_104224双库及uploads完成，pg_restore目录验证及3项SHA256通过；备份在data/backups，权限600。

## 修改文件

Contracts master-plan-dashboard.ts及新增合同测试；API Dashboard Service/Controller、HTTP授权及PG测试；Web App路由/导航、MasterPlanGaps页面及unit测试、GapList可选保留状态、Chrome新页测试；integration-guide/runbook；REV3总控、主要进度及本验收记录。无migration、新依赖、业务数据/权限初始化或同步flags变更。

## 发布与人工验收

源码提交/GitHub同步、标准deploy.sh all/check、运行环境健康、Repository=Web=API与部署后Chrome结果将在完成后补齐。回滚使用先前保留应用代码/镜像走标准部署，不覆盖业务数据库，不变更调度或6项flags。发生生产权限变更或migration需求应STOP/NO-GO；本轮没有该需求。

人工验收建议：登录已有overview授权账号，从导航进入新页面；核对9类数量及选Tab联动、组合顶部条件、分页/搜索/排序与各类完整导出；核对原综合页和在制进度页面。最终状态只能WAITING_MANUAL_ACCEPTANCE，须用户确认后才PASS。

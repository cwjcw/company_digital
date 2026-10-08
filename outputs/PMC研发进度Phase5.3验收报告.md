# PMC 研发进度 Phase 5.3 验收报告

当前状态：已完成 / **Phase 5.3：PASS**；2026-10-08 09:11:13（Asia/Shanghai）。
最终部署版本：`77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5`。

## 范围与实现

图表看板新增独立订单号、品号、品名筛选，三者均为远程搜索多选；客户、事业部和研发/设计BOM/工艺路线状态也支持多选。空数组代表全部。候选沿用统一 `/table-filters/candidates`，参数resource=pmc-rd-progress、field白名单、search关键词、limit=50、withMeta=1，200ms搜索防抖，缓存按登录身份/租户/权限范围隔离。后端SQL在active研发进度授权集上DISTINCT/ILIKE/LIMIT，不从浏览器当前页或ITEM主数据生成候选。服务器既有多值规则最多50值，远程Select对应阻止超过50项。已选值跨关键词保留，支持删除单项和清空。

同维度多个值用现有FilterRule `in/values` 表示OR，维度及日期/未完成/其他高级与列头条件之间AND。API无需新增路由或参数协议，直接沿用 `filterGroup` JSON。前端URL保存多选JSON数组并兼容已有单值链接；数组转换只在前端查询构造器进行，API不会收到数组伪装的单值。单值历史链接原有语义保持。品名按真实名称DISTINCT，同名不同品号属于同一名称候选并由名称IN匹配全部相关项。

明细停止渲染顶部常驻Card/Form和快速搜索，不保留空wrapper；复用现有KdosAdvancedFilter Popover，增加业务条件区域（日期周期/日期、订单/品号/品名、事业部/客户、三状态、未完成），原有类型化高级规则和列头筛选继续提供。已应用值与编辑草稿分开；打开恢复、取消不应用、应用后关闭仍有效，重置清空维度/标准规则/列条件并恢复按日+上海昨天。高级筛选(N)按有值维度计数，日期计1，额外高级规则及列筛选计入。授权导出与字段显示仍在工具栏。两Tab共享已应用条件，KPI/环节/状态图表和明细同口径；分页及列偏好跨Tab保留，条件变化回第一页。

日期继续使用原orderDate包含式from/to，按日/月/年/自定义沿用上海业务日历。移除页面同步状态读取/显示，未修改同步接口、计算器、E10、watermark、候选订单规则或数据库模型。

## Excel与权限

导出继续调用平台 `/table-exports/pmc-rd-progress` 与已有ExcelJS。日期/onlyIncomplete等放context，多选与标准/列条件合并为FilterGroup；后端printRows调用原QueryService.list，继承tenant/RLS、active、字段读权限以及read范围ANDexport范围，并服务端分批查询全部匹配记录。前端不传当前page/pageSize作为导出范围；输出业务中文表头、真实业务值及当前显示列，排除技术ID和操作列。导出文件名pmc-rd-progress.xlsx。

候选API仍检查资源read、字段read、tenant和dataScope。自动化新增PMC候选OWN范围/active/租户RLS/模糊搜索/最多50/未获权字段拒绝和401等验证。只用现有账号运行时登录/只读查询及下载；未输出、复制或提交凭据，未修改账号密码/权限。

## 修改文件

1. apps/web/src/modules/pmc-rd-progress/PmcRdProgressPage.tsx
2. apps/web/src/modules/pmc-rd-progress/PmcRdProgressPage.spec.tsx
3. apps/web/src/modules/pmc-rd-progress/ReportFilterControls.tsx
4. apps/web/src/modules/pmc-rd-progress/rd-progress.model.ts
5. apps/web/src/modules/pmc-rd-progress/rd-progress.css
6. apps/web/src/shared/KdosDataTable.tsx（可选业务高级区域/查询上下文/隐藏快速搜索；其他页面默认行为保持）
7. apps/web/src/shared/advanced-filter.tsx（在既有面板生命周期承载业务条件）
8. apps/web/e2e/pmc-rd-progress.real.spec.ts
9. apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.query.spec.ts
10. apps/api/src/modules/pmc-rd-progress/pmc-rd-progress.filter-sources.spec.ts
11. .agents/skills/kdos-form-platform/SKILL.md
12. docs/pmc-rd-progress.md
13. outputs/CODEX_PROGRESS.md
14. outputs/PMC研发进度Phase5.3验收报告.md
15. outputs/pmc-phase53-browser-summary.json
16. outputs/pmc-phase53-export.json
17. outputs/pmc-phase53-combined-export.json
18. outputs/pmc-phase53-production.json

新增数据库Migration：无。新增npm依赖：无。新增API：无。未修改业务数据、数据库连接配置或Docker Compose。

## Skill

在现有Dashboard/Report规则中合并两条：完整高级筛选应避免重复完整常驻条件，明确业务需要的1～2高频快捷条件可以保留；高基数维度使用可搜索、远程、限量Select，业务允许时多选。不全局禁止快捷条件。Skill Creator quick_validate通过。

## 自动化、真实Chrome与正式部署

- 页面专项27/27、公共高级筛选9/9。
- PMC API专项5 suites/79 tests。
- API全量87 suites/744 tests通过，1项既有skip；其他workspace已通过。
- Web全量31文件/233项通过（单worker，419.83秒）；公共表格18项及高级筛选9项包括在回归中。
- Chrome最终预验收18/18通过（3.0分钟）。最终LAN生产Chrome18/18通过（1.9分钟），覆盖用户7个场景、旧四样本/Drawer/权限/四周期/分页/sticky与1366/1920桌面布局；E2E登录/权限验证通过。
- 最终生产实际Excel：完整订单/品号/事业部/双状态组合页面2条、Excel2条；高级面板清订单/品号后3条、Excel3条，逐行中文事业部及状态核对通过；2026全年只看未完成，页面100/total5361/Excel5361。
- 全workspace typecheck/lint/build通过；最终E2E修正专项eslint及diff检查通过。保留既有Portal Fast Refresh warning、Vite大bundle提示、Ant/ts-jest提示及宿主Node22/要求24提醒；实际Docker构建沿用Node24。
- 首轮全量命令多传分隔符导致worker未受限、资源竞争超时；只停止自有测试进程，单worker全量复测通过，未修改无关模块/测试。
- Chrome正样本通过同一候选API按2026年取样，避免仅往年存在的active候选；Excel断言复用当前“品号”名称。生产首轮清空用例force点击未确认可见图标命中，E2E改为hover→可见图标普通点击→标签0断言→应用；产品代码保持，相关四项重复两轮8/8通过（56.7秒），最终完整生产18/18通过。

实际执行 `./scripts/deploy.sh all`，只构建更新API/Web；E2E修正独立提交后再次部署以统一SHA。源码实现提交c235856，最终提交`77e7a8cf40a60f2b743ae7947fdf11aaeb1018a5`，未push。最终 `./scripts/deploy.sh check` 输出Web/API/Repository均77e7a8c、STATUS CONSISTENT；`./scripts/healthcheck.sh` 的Web/API/Swagger/OpenAPI/PostgreSQL全部通过。LAN公开health/build-info再次读取确认完整SHA一致。

PostgreSQL healthy，容器ID仍b679ba44dd7507ac797759ed41acdc77f1757f5fcf9bec2f0918565352583c44、启动时间仍2026-10-07T09:41:29.703189989Z；原data/postgres挂载/镜像/localhost15433保持。API仍DATABASE_HOST=postgres、DATABASE_PORT=5432，未新增API宿主端口。临时Vite5173已停止，临时代理配置已删除，正式env/Compose未改。没有migration、seed、ERP同步或业务数据修改；未修改账号密码/权限。

运行方式：Web使用 `pnpm --filter @tracker/web exec vitest run --maxWorkers=1 --testTimeout=15000`；API使用 `pnpm --filter @tracker/api test`；生产E2E复用 `scripts/test-pmc-rd-progress-e2e.cjs`，外部凭据只在运行时加载，E2E_BASE_URL覆盖为同一生产LAN入口。报告不记录用户名、密码、token。

## 部署前备份

标准scripts/backup.sh已完成（20261008_085215）；双库pg_restore --list检查和文件SHA256通过，原数据库/卷保持。

| 文件 | SHA256 |
| --- | --- |
| data/backups/four_department_tracker_20261008_085215.backup | 191165e7378405b2bd5563d8229355c10d5e9dea603df71ce0e1713f6c6325ee |
| data/backups/kdos_20261008_085215.backup | e06bcb932b6dd5ba6c509a910a8b00719e7f533bbfa5e1d3a56aea8cba352320 |
| data/backups/uploads_20261008_085215.tar.gz | b02ccb3b322c497e6181ca830fd8670171eaa2e6619699c0182a25984da50310 |

无需迁移、seed或ERP同步。

## 人工验收

1. 登录正式入口 http://192.168.1.249:15172/pmc/reports/rd-progress ，选择按年2026；核对订单号、品号、品名为三个独立可搜索多选。
2. 搜索并选择两个订单，继续搜索不丢失已选；查两个品号、两个品名，查询后检查KPI及状态分布变化，可移除一项或清空。
3. 组合订单+品号+事业四部+未开始/待工艺两状态，查询后切明细：没有常驻筛选卡片，只有高级筛选入口与字段/导出等标准工具栏。
4. 打开高级筛选，核对完整条件和已选值；修改后取消应保留原查询，再次打开恢复原值；修改后应用，关闭仍保持结果。日期计1维度，多个同维度值计1项。
5. 点击导出，用Excel/WPS打开：核对中文表头/日期/事业部/品号/状态与全部筛选后的记录数，不只当前100条；2026全年只看未完成可验证跨页全部导出。
6. 高级筛选重置后业务多选为空、日期为按日+上海昨天；切看板仍显示相同重置状态。保留分页/列偏好和订单/品项详情。

## 已知限制

- 每次远程候选最多50；继续输入更精确关键词检索。每维度最多50个值沿用平台规则。
- 同名品名筛选匹配该名称的全部授权品号，不将品号伪装成品名值；品号可进一步精确组合。
- 历史来源中未映射事业部数据原样保留；不猜测补齐。
- 外部HTTPS入口本机连接受限；正式验收采用同一生产Web/API的LAN入口，不修改域名或凭据文件。


## 26项完成标准

- [x] 1～3：看板订单号存在、远程搜索、多选。
- [x] 4～6：看板品号存在、远程搜索、多选。
- [x] 7～9：看板品名存在、远程搜索、多选。
- [x] 10～12：KPI/图表共享条件，多值OR/跨维度AND真实结果正确。
- [x] 13～16：明细旧常驻筛选停止渲染，仅高级筛选承载完整条件和多选。
- [x] 17～18：两Tab共享已应用条件，关闭面板继续生效，取消草稿不改变查询。
- [x] 19：导出继承全部条件，全匹配记录，不受页面分页限制。
- [x] 20～21：Skill合并避免重复UI和高基数远程下拉规则。
- [x] 22～23：自动化与最终Chrome生产18项通过。
- [x] 24～26：typecheck/lint/build通过，正式部署成功，健康通过。

最终恢复入口：outputs/CODEX_PROGRESS.md。本阶段待完成事项：无；已知边界见上方限制，未发现未解决异常。

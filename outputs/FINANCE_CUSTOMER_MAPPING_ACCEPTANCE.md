# Finance customer mapping Phase 1 acceptance

结果：**PASS（按用户最终范围及严格“10月12日以后”执行）**。验收时间：2026-10-13，Asia/Shanghai。

## 最终交付范围

模块：**财务中心 → 基础数据 → 客户对应表**，没有额外的“财务管理”标签。当前只保留本次上传的 **138条**，全部客户编号唯一，待分类0条。原计划的609客户全量补齐已取消，另外471条从未提交到财务表，无需删除历史业务记录。

以后仅新增 E10 `CreateDate` 或 `LastModifiedDate` 在 **2026-10-13 00:00:00及以后**的客户编号。此为“日期严格晚于2026-10-12”的明确实现；曾发起可选边界澄清并在无答复时告知该起点。如用户希望包含10月12日，需将唯一策略文件 `packages/contracts/src/finance-sync-policy.json` 的 minimumSourceDate 改为2026-10-12，重建/部署后再运行，不能只改提取程序。当前真实合格源客户0条，实际日任务新增0条，财务总数保持138条。包含10月12日的只读勘查有1条源记录，未按该边界导入。

旧客户若后续修改日期满足条件，且财务表中不存在，同样新增编号、两项分类NULL。已有客户的分类、版本、创建/更新时间均不被同步或种子重跑覆盖；停用、源消失和空源不删除财务记录。138条初始客户不受日期限制，即使其源日期较早也保留。

## 数据与来源核实

E10实际库：`E10_6.0.0.1.NEW.CHS`；主档 `dbo.CUSTOMER`，编号 `CUSTOMER_CODE`，日期 `CreateDate` / `LastModifiedDate`（datetime2）。依据现有 `automation/customer_import/readers/e10.py`、实际 INFORMATION_SCHEMA 列定义及实际只读查询确认，不猜表名、不从订单推算完整客户。原适配器 SALES_ORDER_DOC JOIN 的客户集合未复用。SETUP_DATE不是本任务创建日期。

连接复用 `basic_code.MSSQLDatabase` 和现有customer_import Python环境。源库仅READ COMMITTED读取，没有NOLOCK、修改/建表、跨项目密钥复制。源GETDATE与GETUTCDATE相差8小时；按现有E10业务本地datetime2/ISO文本比较，未将源日期转UTC。源SQL和后端canonical验证共用策略文件，后端拒绝过早/缺失/非法/带UTC重新解释的创建修改日期。当前单一KAINAN部署对应已验证的E10主账套；不把这份源任意复制到其他租户。

CSV已按要求纳入受控种子目录，UTF-8 BOM。统一加密容器检测先于XLSX解析；当前ExcelJS读该生产器的XML命名空间失败，使用只读OpenXML验证CSV与XLSX完整一致，不改原文件、不为产品引入第二套解析框架。

| 校验 | 实际结果 |
|---|---:|
| 初始数据/唯一编号 | 138 / 138 |
| 业务一部 | 83（外销82、内销1） |
| 业务二部 | 7（全部外销） |
| 业务三部 | 48（全部内销） |
| 内销/外销 | 49 / 89 |
| A140 | 业务一部 / 内销 |
| 待分类 | 0 |
| 当前符合新增日期的源客户 | 0 |
| 初次种子实际新增/冲突 | 138 / 0 |
| 种子重跑 | repeated=true，复用原逻辑批次结果；实际新增0、记录仍138，人工分类不变 |
| 日任务及重跑 | SUCCESS，read=0 / created=0 / skipped=0；重跑repeated=true |

A097-A/B/E、A108与A108A、C031及其-A/-B/-C/-LP保持独立字符串编号，不去前导零、不做模糊归并。

## 数据库/API/权限

新增迁移：`FinanceCustomerMappings1722920088000`（文件1722920088000-FinanceCustomerMappings.ts）。只创建 `finance_customer_mappings`、`finance_customer_sync_runs`，不更改PMC表或旧数据。客户表UUIDv7、tenant/customer复合唯一、分类枚举CHECK、稳定用户UUID创建/更新外键、版本号、四项审计字段；两个表启用并FORCE租户RLS。写入设置事务tenant context，显式tenant条件、乐观版本、同事务Audit。迁移down禁止丢弃财务数据。

**无新增npm/Python依赖。无E10数据库结构变动。无KDOS SQL迁移改动，18项现有迁移全部SKIP。**

| 接口/页面 | 行为 |
|---|---|
| `/finance/base-data/customer-mappings` | 页面；`/finance`重定向到此 |
| GET `/api/v1/table-filters/rows?resource=finance-customer-mappings` | 复用平台查询/字段/data scope/FilterGroup/分页/排序 |
| GET `/api/v1/table-exports/finance-customer-mappings` | 复用平台xlsx；全部匹配记录，不限当前页 |
| GET `/api/v1/finance/customer-mappings/summary` | 授权范围内总数/待分类；分类字段不可读时不统计待分类；管理员看到最近成功源同步 |
| PATCH `/api/v1/finance/customer-mappings/:id` | 仅两项分类和expectedVersion；编号/租户/来源/审计字段禁止修改，冲突409 |
| POST `/api/v1/finance/customer-mappings/ingest` | 受保护初始化/日期受限E10 canonical命令，import+create；初始分类还需字段修改授权 |
| POST `/api/v1/finance/customer-mappings/sync-failure` | 受保护失败日志命令，错误摘要不含凭据 |
| 现有权限组/候选/打印/导出能力接口 | 新注册finance资源，不另建权限体系 |

普通人员可由原权限组授予只读或分类编辑；模块管理员以稳定finance code控制。源日期元数据仅用于受控同步，分类字段为人工所有。编号不可编辑，即使管理员也不能通过PATCH改编号。超级权限仍受当前租户边界约束。未授权员工入口/侧栏隐藏，后端独立403；只读/字段和OWN/CUSTOM范围回归。导出操作与字段/data scope独立重新验证。未变更任何现有账号权限或密码。

财务的“业务一/二/三/四部”为字典分类，不引用PMC事业部UUID。生产PMC原3条映射与14张Knowledge表逐行完整MD5/数量，部署验收前后**完全一致**（15张表），系统审计身份继续禁用。

## 同步实际运行

唯一user systemd调度：`kdos-finance-customer-sync.timer` → `.service`，每日 **01:00 Asia/Shanghai**，Persistent=true、flock互斥，user Linger=yes。下一次：**2026-10-14 01:00 CST**。不增加n8n/cron重复任务，不依赖用户打开页面。

实际命令：`automation/customer_import/.venv/bin/python automation/finance_customer_sync/main.py --seed`；定时unit执行同一main.py（无--seed）。已实际 `systemctl --user start kdos-finance-customer-sync.service`，Result=success / ExecMainStatus=0；10:00:49成功0新增，10:02:07重跑成功/幂等。timer现active。下一日自动触发尚未到时，没有把未来执行声称为已发生。

专用、关联现有管理员的有限scope API Key，仅存ignored `data/finance-customer-sync.env`，0600；不含数据库密码，不改账号授权。允许finance import/create及初始分类字段权限，无全平台万能scope。日任务业务审计使用原禁用KDOS系统身份，来源沿用既有合法api。接口始终通过AuthGuard鉴权，没有公开无鉴权写入口。

同步唯一键ON CONFLICT DO NOTHING及租户事务锁防重。响应丢失按同一file-independent canonical内容/运行键/startedAt重试，首次请求参数不变化。每日完整读取日期范围内主档以避免丢失后修改的旧编号；只新增，不推进有风险的假水位。失败可以安全重跑，API可用时记录FAILED；API完全不可用时journal保留失败，下一日任务继续。

## 测试与构建

| 验证 | 结果 |
|---|---|
| API全量最终 | **900通过，1既有skip；103通过suite，1skip** |
| API最终定向/Auth/财务/注册 | 46通过（含新增日期验证） |
| Web全量 | 46文件、357通过 |
| Web财务专项 | 7通过；待分类修复后复跑通过 |
| Contracts | 22通过 |
| Python | 5通过：138种子、相同参数网络重试、源失败脱敏、空源、共享截止日/实际列查询 |
| 独立Postgres18 | **20检查通过**：真实SQL、日期拒绝、138初始化/防覆盖、枚举/唯一、并发、跨租户、只读/字段/data scope、跨页xlsx、失败重试、non-superuser RLS |
| 独立fresh全迁移 | **87迁移通过**；原审计CHECK真实存在的全schema中执行成功及失败sync命令通过；完整Nest依赖/注册bootstrap通过 |
| Chrome财务角色 | 4通过：管理员/编辑者/只读/无权限，真实公共表格及pending请求 |
| Chrome Knowledge回归 | 17通过/1原凭据门控skip，覆盖单目录/旧链接/发布/Autosave/文件/移动宽度 |
| API/Web typecheck/lint/build | 全通过；仅原有Fast Refresh/chunk size/测试环境警告 |
| 真实管理员浏览器 | **6组PASS**：入口、三字段、A140、保存、待分类0/服务端筛选、下载Excel、原权限入口（检查合并分组） |
| 真实普通员工浏览器 | **2组PASS**：E2E登录/权限验证通过；入口隐藏、直接页面拒绝、列表/导出/编辑API403 |

实际下载：`outputs/finance_customer_mappings_2026-10-13.xlsx`，138数据行+1中文表头，页面分页100却导出全部138；建议文件名finance-customer-mappings.xlsx。标准平台默认导出3核心字段，不导出操作、UUID、source和默认审计技术列。未分类单元格沿用平台业务显示“—”，数据库仍NULL，不伪造分类。隔离验证用141条/分页50、字段/data scope/筛选/其他租户xlsx验证全部记录与权限一致。

## 发现并已解决的问题/限度

1. 实际公共表格server callback仅含表内条件，原财务pending context未进入列表：在财务查询端合并同一FilterGroup，导出仍复用公共能力；实际Chrome及服务端SQL验证通过，不改其他模块公共行为。
2. 新finance模块还需进入后端Portal排序allowlist：补对应入口与原Auth回归，不改用户权限。
3. 初次日任务审计来源system违反旧ck_audit_source：事务全部回滚、没有471客户或部分记录落库。改为合法api来源+原禁用system身份；补最小测试库原约束及真实87迁移schema上成功/失败命令，并实际unit成功重跑。历史失败journal保留，不掩盖首次故障，不修改旧审计约束。
4. 测试执行器的CSV相对路径、AntD中文间距/图标按钮和空列表不显示“共0条”定位已修正；曾重叠启动E2E造成自建Vite关闭的连接失败，顺序复跑4/17全部通过。属于已解决验收脚本问题，无剩余产品失败。
5. 未执行生产财务编辑/只读专用账号的正向登录：本轮没有提供这类已获finance授权的实际账号，未擅自授权。已用自动化Chrome角色及真实隔离数据库证明权限；生产普通员工实际只验收其现有拒绝状态。
6. 未在生产E10新建测试客户；未来真实新增的时间变化由隔离canonical、模拟提取、真实master只读日期查询覆盖。桌面Excel/WPS手工打开未执行，ExcelJS实际下载读取及xlsx行/表头校验通过。
7. 可选日期边界问题未收到答复，交付按已明示严格晚于12日的13日起；当前不包含12日。不把此解释写成用户已确认的回答。

## 备份/部署/回滚

开始HEAD：`7356e2f9695acf3d4f4c30859bef92ee623acf89`。最终部署SHA：**`c69e5199cbc6c8a955d301b3ba72175354b3e008`**。

备份：20261013_093503，双库custom dumps和uploads（含.private），约748MB/8MB/3MB；pg_restore目录检查、全部SHA256、最终0600权限复核通过。证据：FINANCE_BACKUP_VERIFICATION.json。

执行：受控compose先构建API镜像，`./scripts/migrate.sh`自动完整备份，仅执行新增finance迁移；既有KDOS迁移脚本全部SKIP；`./scripts/deploy.sh all`及最终`./scripts/deploy.sh check`。HEAD/Web/API/Worker均为上述完整SHA；四容器healthy，notification Dispatcher active；原Postgres18/volume/内部postgres:5432及localhost15433均未改。

调度unit已安装到当前user systemd，仅finance timer被临时停止并恢复。测试服务器network none/tmpfs/无宿主端口/无生产卷；测试库残留0，专用测试容器已停止移除。没有在生产创造测试客户；管理员只保存A140当前同一分类值验证流程，版本/审计正常保留，不改原业务分类。

回滚：仅停用finance timer；使用已留镜像 `knplan-api:finance-base-7456a4c`、`knplan-document-worker:finance-base-7456a4c`、`knplan-web:finance-base-468af4d` 恢复原运行应用；**保留财务表、138数据及审计**，不执行migration down/删卷。完整备份用于事故恢复到经确认的隔离目标；不要覆盖正式库或删旧PMC表。

## 修改文件（28个源码/测试/配置/种子文件）

- `apps/api/src/app.module.ts`
- `apps/api/src/auth.spec.ts`
- `apps/api/src/auth.ts`
- `apps/api/src/common/filtering/table-filter-registry.spec.ts`
- `apps/api/src/migrations/1722920088000-FinanceCustomerMappings.ts`
- `apps/api/src/modules/finance/finance.application.service.ts`
- `apps/api/src/modules/finance/finance.controller.ts`
- `apps/api/src/modules/finance/finance.filter-sources.ts`
- `apps/api/src/modules/finance/finance.module.ts`
- `apps/api/src/modules/finance/finance.query.service.ts`
- `apps/api/src/modules/finance/finance.repository.ts`
- `apps/api/src/modules/finance/finance.spec.ts`
- `apps/api/src/modules/finance/finance.types.ts`
- `apps/web/e2e/finance-ui.spec.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/modules/finance/FinanceCustomerMappings.spec.tsx`
- `apps/web/src/modules/finance/FinanceCustomerMappings.tsx`
- `apps/web/src/modules/portal/ModulePortal.tsx`
- `automation/finance_customer_sync/README.md`
- `automation/finance_customer_sync/kdos-finance-customer-sync.service`
- `automation/finance_customer_sync/kdos-finance-customer-sync.timer`
- `automation/finance_customer_sync/main.py`
- `automation/finance_customer_sync/seeds/finance_customer_mapping_seed.csv`
- `automation/finance_customer_sync/test_sync.py`
- `packages/contracts/src/finance-sync-policy.json`
- `packages/contracts/src/finance.ts`
- `packages/contracts/src/index.ts`
- `scripts/test-finance-postgres.cjs`

另有本报告、CODEX_PROGRESS.md、验证JSON/日志和实际下载xlsx在outputs。运行时secret配置未提交。三次相关源码提交留本地，无Git push。

## 人工验收

1. 登录有finance查看权限的账号，从工作台进入“财务中心”，确认侧栏直接基础数据→客户对应表，无财务管理标签。
2. 查看客户总数138、待分类0；搜A140，确认业务一部/内销；核对不同编码后缀不合并。
3. 选一条获权记录点“修改分类”（或双击行），确认客户编号不能改；两项分类单选并允许清空；保存后即时刷新。两浏览器旧版本提交应显示409原因。
4. 高级/列筛选部门、内外区分；开启“待分类”当前应空列表；清空筛选点击导出，Excel应138行，不能只有当前100行。
5. 由管理员在原权限管理授予财务人员需要的动作/字段/data scope（本轮未代为改权限），验证只读不显示修改、未授权入口隐藏且直接API403。
6. 检查 `systemctl --user list-timers kdos-finance-customer-sync.timer`、service日志和成功同步时间。可安全手工start此service；不得向生产E10插测试客户。
7. 未来真实客户CreateDate或LastModifiedDate>=2026-10-13零点时，下一次同步只为不存在编号新增NULL分类；财务人员补齐后再同步不覆盖。早于截止日的历史客户不补入，138原始客户不因日期旧而删除。

最终：**Finance customer mapping Phase 1 PASS**。

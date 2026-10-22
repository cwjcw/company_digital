# KDOS-MPS-REVIEW-DUE-IMPORT-FIX-003 验收报告

状态：**WAITING_MANUAL_ACCEPTANCE**。

本轮仅本地开发、隔离 PostgreSQL/HTTP 与本地真实 Chrome 验证。未部署、未提交或推送 GitHub、未向生产上传/导入文件、未修改生产业务数据或权限组，未启动同步/调度。自动测试结果不代表用户人工验收完成。

起始及当前 Git HEAD：`18357f6bb3a3384b902eec3c76315b73a893edd8`。起始工作区干净；本任务修改留在工作区，尚无发布版本或新 Commit SHA。

## 1. 真实 ExcelJS 异常及根因

用户最终指定 `/home/Jerry/下载/周生产计划_订单批次图号入库时间.xlsx`，并在同一路径更新为未加密文件。实际验收使用该更新后的原件，没有用模拟文件替代。

| 项目 | 结果 |
| --- | --- |
| 文件大小 | 43,966 bytes |
| SHA-256 | `e65a4abb13e22d4b9a1603e5e324431919040ede1c43df610eeeb628860614f1` |
| 运行时 | Node.js 24.19.0 / 项目安装的 ExcelJS 4.4.0 |
| ZIP、CRC、全部 XML | 完整、通过 |
| 工作表 | 订单批次及入库时间 |
| 六个业务列 | 顺序正确、无隐藏列错位 |
| 业务记录 | 1,114 |
| 数量合计 | 1,009,696 |
| 三字段业务键重复 | 0 |
| 公式 | 0 |

直接执行原始 `await workbook.xlsx.load(buffer)`，真实异常为：

```text
TypeError: Cannot read properties of undefined (reading 'sheets')
at XLSX.load (.../exceljs/lib/xlsx/xlsx.js:323:37)
```

该文件的工作簿、样式、共享字符串、工作表及表格 XML 使用合法的 SpreadsheetML 命名空间前缀，例如 `x:workbook`、`x:sheets`。ExcelJS 4.4.0 的 `WorkbookXform.parseOpen/parseClose` 按 `workbook/sheets` 等原始标签名称匹配，未识别这些等价前缀，因此没有生成 workbook model。

只适配命名空间后，真实文件进一步复现：

```text
TypeError: Cannot read properties of undefined (reading 'name')
at .../exceljs/lib/doc/worksheet.js:920:20
```

第二处根因是文件使用合法的内部绝对表格引用 `Target="/xl/tables/table1.xml"`。ExcelJS 将表格索引为 `../tables/table1.xml`，而关联查找直接使用原 Target，导致表格 model 为 undefined。不能通过删除表格、工作表或忽略异常解决。

修复采用资源专属读取适配器：

1. 首先调用现有统一加密检测，再进行 ZIP CRC 和全部 XML 的严格检查。
2. 使用显式依赖 `saxes` 6.0.0，根据命名空间 URI 与 SAX token 位置，在内存中将 SpreadsheetML 元素前缀转换为等价的默认命名空间表示；保持其他命名空间及属性身份。
3. 仅将工作表关系中的内部 table 绝对 Target 转为指向同一 ZIP 成员的相对 Target；不修改外部链接。
4. 首先保留原始 ExcelJS 读取尝试；失败且存在经验证的等价适配时，才由新的 ExcelJS Workbook 读取内存副本。再次失败明确报兼容性错误，不吞异常。
5. 不改磁盘原件、不改变单元格文本、业务属性、数量或日期、不移除工作表或表格，也不修改全局 ExcelJS/其他业务导入器。

独立 Python 标准库 ZIP/XML 读取器验证了全部 1,114 行 × 6 列，与兼容读取后的 ExcelJS 结果逐项一致。另对原 ZIP 各 XML part 与内存适配副本做完整树比较：元素 namespace/local name、文本及业务属性均一致，table Target 解析到同一 package part；非 XML 原件内容保持一致。原文件最终 SHA-256 与读取前一致。

本次批次号含斜线的 237 行、图号含斜线的 28 行全部完整保留，全部日期及数量逐项一致。真实文件的验货名称均非空；可空情况另用隔离样例验证。

补充：用户最初提供的同路径文件为 48,062 bytes，SHA-256 为 `f1c11cb65b14bd0c4a88168e03ce43d10f9ecbcae3e91acbe3801454ec038fbc`，具有 `88 7d 1c` 加密容器签名且没有 ZIP 目录，直接 ExcelJS 报 `Can't find end of central directory`。用户随后更新原件，本报告的 1,114 条验收基于更新后的有效 ZIP 文件。两份文件的证据分开记录，未尝试绕过加密。

## 2. 单一导入合同

页面顶部只提供一个「导入Excel」，弹窗不再出现 STANDARD/SOURCE 模式选择器，请求不携带 `view`。

| 文件结构/行身份 | 行为 |
| --- | --- |
| 六列业务字段、没有记录ID和版本列 | 全部新增 |
| 八列、记录ID和版本同时为空 | 新增 |
| 八列、记录ID及正整数版本同时有效 | 按租户 + UUID 更新，并检查版本 |
| 只存在一个身份列，或行内只填写其中一个 | 明确拒绝 |
| 新增业务键已存在/命中保留来源身份 | 冲突，无确认 token，不自动转为更新、合并或覆盖 |

新上传统一使用已有 STANDARD 身份语义写入私有 preview ledger；前端不接触模式。旧客户端附带 `view=SOURCE` 也不会恢复新上传的来源键自动更新。

历史 SOURCE 预览、既有确认结果/幂等回执、不可变来源三键及历史事件均保留。仅历史服务端 ledger 的 SOURCE 批次按原语义确认、重放；新上传不产生这种批次。手工/统一导入新增仍不等于确认外部来源同步，`lastSyncedAt` 保持空，未来接入来源需要原有人工核实边界。

八列模板继续独立下载，字段与正式 Registry 共用；说明明确六列全部新增、八列按 ID/版本更新，无需选择模式。没有新增第二套字段 Registry 或导入账本。

## 3. 错误处理及预览

| 类型 | 结果 |
| --- | --- |
| 真正加密容器、加密 ZIP 成员 | 原样提示 `该文件被加密,请解密后再导入.` |
| 非 ZIP、CRC 错误、缺必要 package part、畸形 XML | 提示 Excel 文件结构不完整或损坏 |
| 无法安全适配的 Excel 结构 | 明确兼容性错误，禁止确认 |
| 表头错误 | 指明缺失字段、重复或不接受的表头，或缺少配对身份列 |
| 行错误 | 返回 Excel 行号和具体字段；公式缓存/精度错误也标明字段 |

服务端日志保留实际异常类型、真实调用栈帧、解析阶段及 requestId。异常首行可能包含 XML/单元格内容，因此不直接输出原始异常消息、业务行、上传内容或凭据。真实兼容性报错的安全通用消息及完整受限复现证据已记录在本机。

预览保留总数、新增、更新、未变化、提前、推迟、数量变化、冲突及错误统计。解析错误与业务校验错误合并并按行排序，仍显示有效行的统计；任意错误/冲突不发确认 token。无查看权限时仍遵守既有比较值和统计裁剪。

## 4. 验证结果

最终验证结果：API 7组93项、Web 4组20项、Contracts全量5组33项、隔离PostgreSQL/HTTP/真实Chrome64场景全部通过；递归typecheck、lint、build通过。lint保留1项既有ModulePortal FastRefresh警告，build保留既有大包提示。

Web测试曾暴露异步metadata旧DOM引用及AntD弹窗动画时序问题：测试改为等待异步渲染完成、定位当前输入及等待可见性，未修改业务编辑逻辑、未移除断言。最终整组20项通过。

以下覆盖点已在隔离 PostgreSQL18 的正式 Application/Query/Spreadsheet 命令、HTTP 或 Chrome 中执行：

| 验收项 | 结果 |
| --- | --- |
| 六列新增、八列新增、八列真实ID更新/混合文件 | 通过 |
| ID/版本单列、半填、非法ID/版本 | 拒绝，无确认 token |
| 六列重复上传、业务/保留来源键冲突 | 冲突，不重复创建/覆盖 |
| 日期推迟、提前、恢复旧值 | 各增加一次 IMPORT 历史及计数 |
| 日期相同、Decimal 等值 | 未变化，无历史/版本虚增 |
| 数量/验货名称修改 | 正式审计，交期计数不增加 |
| 首次新增 | UUIDv7、计数0、无交期历史、无同步完成时间 |
| 重复及并发确认 | 一次提交、同一回执，无重复计次 |
| 陈旧版本/撤销权限/确认人/租户不同 | 重新校验并拒绝 |
| 混合文件日期事件后审计失败 | 当前值、计数、历史、新增行、审计及确认标记整批回滚 |
| 旧SOURCE ledger及回执重放 | 原有身份/UUID/历史保留，不误关联 |
| 手工新增/六字段编辑/历史/Excel导出 | 回归通过，Decimal保留 |
| 无import、无create、无字段填写/修改授权 | 403 |
| import/create/read数据范围、跨租户及真实用户状态 | 继续生效 |
| FORCE RLS、不可变来源键、历史保护及计数一致性 | 继续生效 |
| 加密、ZIP CRC损坏、XML损坏、兼容性诊断 | 专项测试通过 |
| 本次真实原件 | 全部1114行预览、新增1114、更新0、未变化0、冲突0、错误0；未确认 |

真实 Chrome 使用本地 Web 和隔离 Nest HTTP/PostgreSQL。完成模板实际下载及八列核验、无模式选择器、两种文件上传/预览/取消、合成文件单次确认及刷新、创建/编辑/历史/版本冲突。真实原件也经 Chrome 实际 multipart 上传，显示总记录数1114、新增1114，随后取消；确认请求计数未增加，隔离正式主表数量未因该原件而增加。没有用测试身份访问生产。

隔离数据库采用独立 `postgres:18` 容器、`network=none`、tmpfs 数据目录与独立 Unix socket，不连接生产数据库或生产数据卷。测试创建的数据库由脚本清理；本轮临时PostgreSQL容器已删除，本地Vite服务已关闭。

1,114/1,009,696 只出现在本次原文件核验和可选真实文件验收脚本中，生产解析/导入逻辑没有写死这些数字，也不与历史1,139条进行错误判定。

## 5. 修改文件

- `apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts`：单一上传合同、逐行错误/有效行统计，调用专属读取器；其他资源分支不变。
- `apps/api/src/modules/master-plan-system/review-due-date-workbook.ts`：严格校验、错误诊断、命名空间及内部 table Target 等价兼容。
- `apps/api/src/modules/master-plan-system/review-due-date-workbook.spec.ts`：加密/损坏/前缀/绝对table关系/敏感日志回归。
- `apps/api/src/modules/master-plan-system/review-due-date-import.application.service.ts`：内部无效批次类型错误文案更新；业务事务/历史/权限机制沿用。
- `apps/web/src/modules/master-plan-system/ReviewDueDates.tsx`、`ReviewDueDates.import.tsx`：单一「导入Excel」与无模式流程。
- `ReviewDueDates.import.spec.tsx`、`ReviewDueDates.edit.spec.tsx`：新交互验证；编辑测试等待异步元数据并重新定位当前输入，防止缓存已脱离DOM的旧元素，未删减保存/版本/精度断言。
- `packages/contracts/src/review-due-dates.ts`、`review-due-dates.spec.ts`：模板说明、历史ledger类型兼容注释及合同测试。
- `apps/api/package.json`、`pnpm-lock.yaml`：直接声明已锁定的 SAX 解析器 `saxes` 6.0.0；没有升级 ExcelJS 或全局替换解析器。
- `scripts/review-due-import.postgres-checks.cjs`、`scripts/test-review-due-dates-postgres.cjs`：统一语义/历史兼容/真实文件可选预览及Chrome回归。
- 本报告、`outputs/CODEX_PROGRESS.md`。

无 Migration；历史 migration、RLS、唯一键、外键和历史保护未修改。原文件、逐行业务值、内存适配验证副本、截图及本机日志均仅存忽略目录 `data/mps-review-due-import-fix-20261022/`，目录700、证据文件600，不应提交 Git。

## 6. 生产部署前检查（本轮不执行）

1. 用户人工验收并明确授权 GitHub 同步和上线后，重查 HEAD/工作区/远端；有冲突停止，不覆盖其他任务。
2. 核对本任务白名单、敏感文件及测试结果，只提交获授权的本任务源码/脱敏文档，正常 push，不 force。
3. 备份并验证数据库/相关附件和恢复方式，记录生产主表/历史表统计、版本、既有权限及同步开关。
4. 本任务无数据库结构变更；不得顺便执行 seed、清表、生产确认导入、同步或权限扩展。
5. 按正式流程发布 Web/API，检查 Repository=Web=API、STATUS=CONSISTENT，再做生产真实页面/权限核验。不要使用生产测试记录或代替用户确认真实文件。
6. 部署回退仅恢复保留的旧 Web/API 源码/镜像；不得为回退应用覆盖生产业务数据。旧版双模式语义会重新出现，需要明确记录并告知。

## 7. 影响边界

只改变评审交期表上传分支及其界面/模板说明。其他主计划、PMC分配/通知、财务统计、ERP同步、六项同步开关、n8n/systemd/cron、生产权限组均未修改。没有生产连接或业务写入。本轮无新生产版本、无 commit/push。

人工验收尚未完成，最终状态保持 **WAITING_MANUAL_ACCEPTANCE**，不进入上线、真实确认导入或每日同步阶段。


## 8. 可复核证据与命令

- `api-tests-final.log`：93项通过，含读取兼容、加密/损坏及既有主计划Spreadsheet回归。
- `web-tests-final.log`：20项全部通过；测试命令使用`--no-file-parallelism --testTimeout=15000`，没有跳过测试。
- `contracts-tests.log`：全量33项通过。
- `postgres-chrome-final.log` / `postgres-chrome-summary.json`：64场景通过。
- `real-exceljs-updated.json`：未适配的真实ExcelJS异常和堆栈；`real-independent-validation.json`：完整逐行及XML语义对比结果。
- `real-compatible-result.json`：ExcelJS兼容读取的工作表、行数及数量合计。
- `chrome-real-file.png`：真实Chrome中的1114行新增预览截图（仅受限本地保存）。
- `typecheck-final.log`、`lint-final.log`、`build-final.log`：递归检查通过；最终测试文件变更后又通过Web typecheck/lint。

主要回归命令：

```bash
pnpm --filter @tracker/api exec jest --runInBand --testPathPatterns='review-due-date|master-plan-spreadsheet|spreadsheet-upload'
pnpm --filter @tracker/web exec vitest run --no-file-parallelism --testTimeout=15000 src/modules/master-plan-system/ReviewDueDates.spec.tsx src/modules/master-plan-system/ReviewDueDates.import.spec.tsx src/modules/master-plan-system/ReviewDueDates.create.spec.tsx src/modules/master-plan-system/ReviewDueDates.edit.spec.tsx
pnpm --filter @kdos/contracts test
pnpm typecheck
pnpm lint
pnpm build
```

PostgreSQL脚本必须由`REVIEW_DUE_TEST_POSTGRES_HOST=/tmp/kdos-review-due-pg-.../socket`保护，使用独立临时PostgreSQL18；不允许指向生产。`REVIEW_DUE_REAL_FILE`只用于可选的原文件预览核验，不会执行真实原文件确认导入。Chrome的`REVIEW_DUE_BROWSER_BASE`只能使用本轮隔离Web地址和隔离HTTP测试路由，不使用生产登录。

收尾：源文件SHA不变、Git HEAD不变、`git diff --check`通过，未stage/commit/push；任务临时数据库容器和Web已关闭，其他运行服务未调整。最终状态：**WAITING_MANUAL_ACCEPTANCE**。

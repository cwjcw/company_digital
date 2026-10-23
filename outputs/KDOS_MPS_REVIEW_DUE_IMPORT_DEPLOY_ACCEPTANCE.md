# KDOS-MPS-REVIEW-DUE-IMPORT-DEPLOY-001 正式上线验收

最终状态：**WAITING_MANUAL_ACCEPTANCE**。代码提交、GitHub同步、生产发布及受控Chrome验收已完成；用户人工验收仍待完成，不判最终PASS。

## 版本与Git范围

- 起始本地HEAD、github/main及GitHub main：`18357f6bb3a3384b902eec3c76315b73a893edd8`。
- 项目GitHub remote为`github`，无`origin`；已实际fetch、核对及正常push，不添加别名、不force、不覆盖其他提交。
- 本次发布Commit/GitHub main：`b05df9153671ef9aab2a4e71760035ed270278d4`。
- 发布前生产Web/API：`6aedfdc220ae071ea3a05bf88875811bbac532be`。
- 安全提交17个任务文件，包含代码、必要测试、修复验收报告、设计当前规则及发布准备进度。真实Excel、业务逐行数据、数据库备份、日志、会话/密钥和临时脚本均在Git忽略目录，不入库。
- Repository、GitHub main、Web、API完整SHA均为`b05df9153671ef9aab2a4e71760035ed270278d4`；`./scripts/deploy.sh all`与`check`成功，`STATUS=CONSISTENT`。Web/API/PostgreSQL/Document Worker及Swagger/OpenAPI健康检查通过。Migration保持103项、pending=0，未执行seed或新增结构迁移。

## 本地验收复核

既有本地及隔离验收：API93项、Web20项、Contracts33项、隔离PostgreSQL/HTTP/真实Chrome64场景通过，typecheck/lint/build通过；保留既有FastRefresh和大包提示。本轮在提交前重新运行API93项、Web20项均全部通过。

已复核：单一「导入Excel」、无双模式选择器，六列按新增、八列按ID/版本、已存在业务键冲突、既存SOURCE ledger/历史保留、ExcelJS命名空间及绝对内部表格引用等价适配、明确加密/损坏/兼容/字段错误分类。无新增Migration，通用写入/权限/审计/事务/幂等保护保持。

## 备份

执行正式`./scripts/backup.sh`，备份时间2026-10-22 15:20:12（Asia/Shanghai）。

| 备份 | 字节 | SHA-256 |
| --- | ---: | --- |
| four_department_tracker_20261022_152012.backup | 1059625937 | `50e8e29e5630c815589adab506b03aa8a1bb218999017d76650961f6f4a6d6e8` |
| kdos_20261022_152012.backup | 8155720 | `5b551997124f8d7f21bed1c4f11b7817ed491ac24b6c187178199465bcdb72cc` |
| uploads_20261022_152012.tar.gz | 3029975 | `8ef1e369c4cb031b8b4efa879e1a477b372543cc9adc43f2cb3dd77fdfaf6684` |

均位于`data/backups/`，目录700、文件600；重新读取并计算哈希一致。数据库文件PGDMP签名及容器内pg_restore --list通过，附件tar完整遍历通过。未向生产进行恢复演练。本轮无结构变更，无需数据库回退；如需应用回滚，仅按既有源码worktree/镜像发布方案恢复保留的旧Web/API，不恢复旧数据库覆盖后续业务。

## 发布前生产保护基线

| 项目 | 发布前 |
| --- | ---: |
| mps_review_due_dates | 0 |
| mps_review_due_date_changes | 0 |
| 数量合计 | 0 |
| 交期变更次数合计 | 0 |
| 已应用Migration | 103，pending=0 |

同时记录两业务表完整行指纹、7张权限/授权/范围表的数量及指纹、评审交期权限明细、完整Migration账本。只读REPEATABLE READ事务取证，未假定空表后再跳过检查。

六项开关均为30分钟间隔：base-to-weekly=true、erp-orders=true、execution-rollup=true、inbound-allocation=true、plan-projections=false、shipping-to-base=true。现有任务保持运行，本轮不手工触发或新建同步，不调整n8n/systemd/cron。

## 生产Excel与Chrome验收

用户原文件实际路径为`/home/Jerry/下载/周生产计划_订单批次图号入库时间.xlsx`。文件名未带(2)，但完整SHA-256与本次指定参考值完全一致：`e65a4abb13e22d4b9a1603e5e324431919040ede1c43df610eeeb628860614f1`，43,966字节，确为用户更新的未加密原件，未生成近似文件替代。1114/1009696只用于本次文件验收，未写死在生产导入算法。

已使用用户提供的正式管理员通过生产Chrome登录，metadata200且create/update/import/export/template均可用；未伪造令牌、重置密码或扩大权限。生产操作脚本禁止import-confirm及其他业务写入，仅允许读取、鉴权和import-preview，预览后必须取消。

生产真实Chrome 153.0.8010.52在目标LAN地址完成：

| 验收项 | 实际结果 |
| --- | --- |
| 顶部工具栏 | 新增、导入Excel、下载导入模板、导出均可见且位于同一正式工具栏 |
| 单一导入流程 | 无Radio模式选择、无原始六列来源匹配选项；请求无view参数 |
| 真实六列Excel | HTTP201，总数1114、新增1114、更新0、未变化0、冲突0、错误0 |
| 业务内容核验 | 返回全部1114行；六字段与独立原件读取逐项匹配，数量合计1009696 |
| 取消操作 | 真实原件预览后取消；import-confirm请求0，其他业务写入请求0 |
| 模板下载 | 真正xlsx，mps_review_due_dates_import_template.xlsx；记录ID/版本及六字段，共8列、无真实数据 |
| 八列识别 | 使用下载模板的八列表头、ID/版本留空预览一行成功，随后取消，无确认 |
| 加密提示 | HTTP400，原样提示“该文件被加密,请解密后再导入.”，确认按钮禁用 |
| 损坏提示 | HTTP400，提示“Excel文件结构不完整或损坏，请检查文件后重新导入。”，确认按钮禁用 |
| 手工新增 | 六字段表单正常打开，未保存草稿取消，无manual-create请求 |
| 人工编辑 | 编辑模式进入/退出正常、metadata六业务字段可编辑/四系统字段只读；生产空表，不执行实际保存，保存/历史/并发由既有隔离验收覆盖 |
| Excel导出 | mps_review_due_dates_20261022.xlsx，10列，仅表头，与生产空表一致 |
| 权限 | 正式管理员meta200、对应actions真实有效；无认证模板请求401；无权限403/字段/范围/租户边界由API及隔离PG测试覆盖，未冒用其他账号或改权限 |

页面截图为受限本机证据，不上传Git：`data/mps-review-due-import-deploy-20261022/chrome-toolbar.png`（两个按钮及完整工具栏）、`chrome-real-preview.png`（真实1114行预览）、`encrypted-check.xlsx.png`、`corrupt-check.xlsx.png`（分别显示准确错误）。`chrome-result.json`保存实际响应统计与零确认请求记录。

预览阶段允许产生正式preview ledger，但没有业务表写入。最终只读观察到本时间窗3条评审交期预览，confirmed=0；未清理/修改这些预览。没有新增、修改或删除主表/历史记录。


## 生产前后对比与已确认的并行权限调整

| 保护项 | 发布前 | 验收后 | 结论 |
| --- | ---: | ---: | --- |
| 评审交期主表 | 0 | 0 | 一致 |
| 交期历史表 | 0 | 0 | 一致 |
| 数量合计 | 0 | 0 | 一致 |
| 交期变更次数合计 | 0 | 0 | 一致 |
| 两表完整行指纹 | 各自MD5 d41d8cd98f00b204e9800998ecf8427e | 相同 | 一致 |
| 六项同步配置 | 5启用、plan-projections停用，均30分钟 | 相同 | 一致 |
| Migration账本 | 103，pending0 | 完整账本相同，pending0 | 一致 |
| 评审交期资源权限明细 | 已保存摘要 | 相同 | 一致 |
| 其余6张权限/授权表 | 已保存数量及完整指纹 | 相同 | 一致 |
| role_organization_scopes | 6 | 7 | 用户并行授权调整，已确认保留；恢复验收后的7条基线与最终指纹一致 |

门禁确实曾拦截：部署后首次检查发现role_organization_scopes由6变7，立即停止Chrome预览。只读审计与备份表数据定位2026-10-22 **15:30:19（Asia/Shanghai）**，系统管理员经网页执行`permission_group.updated`，将「采购」角色由「采购课」扩展为「采购课＋四部资材部」。原单条关联被正式命令重建为两条，净增加一条；不是本任务脚本发起的角色操作。原始6条基线和备份完整保留。

用户明确回复“是，保留这项调整并继续预览验收”后才恢复。仅允许该已确认的并行变更，其余业务、权限、flags与Migration仍按原始基线严格核对；本任务没有回写、撤销权限或恢复数据库。不得把6→7描述为所有权限完全没有变化，也不能归因于本次导入修复。

## 剩余范围及恢复

- 没有执行1114条正式导入，没有调用import-confirm，没有开启每日同步、n8n任务或修改六flags。现有调度维持原状，未人工补跑。
- 生产为空，因此新增/编辑的实际提交及历史变化只在隔离环境验证；生产仅开窗/取消、切换模式和下载。真实文件当前预览全部新增是当前生产数据的结果，不是写死的验收规则。
- 无未解决的发布、解析或数据变化异常；人工验收尚未完成。
- 磁盘原文件SHA-256验后保持不变。临时正式浏览器会话文件在收尾删除；未记录密码/令牌到报告、日志或Git。
- 新代码及修复验收报告已包含在发布Commit；正式上线报告和收尾进度作为本机outputs交付记录保留。源码/配置无未提交修改，运行版本与GitHub main一致，不为收尾文档单独改动发布版本。
- 回滚如有需要仅恢复保留的应用版本；不得恢复旧数据库备份覆盖生产数据。本轮没有执行回滚或数据库恢复。

## 最终结论

| 项目 | 结果 |
| --- | --- |
| 代码提交 | PASS |
| GitHub同步 | PASS |
| 生产部署 | PASS |
| Excel上传预览 | PASS（真实原件，只预览并取消） |
| 模板下载 | PASS |
| 业务数据未变化 | PASS |

`Repository=GitHub main=Web=API=b05df9153671ef9aab2a4e71760035ed270278d4`

`STATUS=CONSISTENT`

**最终任务状态：WAITING_MANUAL_ACCEPTANCE**。自动发布及受控验收成功，不代表用户人工验收已完成。完成后停止，不进入真实确认导入或定时同步。

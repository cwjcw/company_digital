# 出货计划非必填字段修复验收

日期：2026-10-20。基线：a979d3b26cef014b196695a485360045cbf86bdb。
修复提交：6c9b2276e582b24e15107d4cc482703aedbf4662。

## 规则与范围

- 出货计划itemName/orderDate/modelAge均允许留空，不填虚假名称；其余六个新增必填项和修改校验保留。
- config.requiredOnCreate移除itemName；requiredAlways只保留原有divisionId；Contracts将itemName.required=false。
- Preview/Confirm调用同一Application规则；空串规范化NULL，PATCH允许清空三个字段。
- Excel已知字段、记录ID/版本按实际表头定位；删列/移列不会照隐藏定义旧列号读错。完整结构吻合时兼容仅改显示标题的旧文件。
- 身份两列必须保留：两格空新增，真实ID与版本都填更新；部分填写、身份列删除、非法ID、未知ID、版本0/旧版本拒绝。
- 被删除的可选列表示未提交，更新保留原值；保留列但单元格空表示清空。
- 未修改任何生产业务数据，未读取或导入用户Excel，无测试创建/更新/导入预览请求发到生产API。

## 数据库门禁

READ ONLY查询生产information_schema.columns和pg_constraint：

| 字段 | NULL允许 | 默认值 |
|---|---|---|
| item_name | YES | 无 |
| order_date | YES | 无 |
| model_age | YES | 无 |

额外CHECK仅交期编码格式、计划数量非负、版本为正。无需migration；无迁移文件变化，不执行数据库结构变更。

## 验证

- API直接相关4组119项通过；API全量112组1071项通过，4组33项原有条件跳过。
- 独立新增用例24项通过（从有值清空、全空/NULL/省略、新增与更新Excel预览/确认、六个必填拒绝、列删除/错位、真实ID/版本）。
- Web全量55组419项通过，包含三个字段全空新增场景及原有其他必填拒绝。
- Contracts全部29项通过。
- 全工作区typecheck/lint/build通过。原有Portal FastRefresh警告与Vite大包提示保留，无新增错误。
- Chrome：生产静态页面+全部API拦截，1项通过。真实浏览器完成空必填拒绝、补齐六个必填后保持三字段空并提交；POST被测试拦截，不进入生产。

## 备份与上线

- 正式脚本backup.sh完成20261020_105241两库/uploads备份，pg_restore列表与SHA256验证完成；备份仅保存在受限data/backups，不提交Git。
- 运行中旧API只读元数据对照：itemName.required=true，requiredOnCreate/requiredAlways均含itemName；下单日期和新旧款false。
- deploy.sh all/check完成：Repository=Web=API=6c9b2276e582b24e15107d4cc482703aedbf4662，STATUS=CONSISTENT。
- healthcheck.sh：API/Web/document-worker/PostgreSQL/Swagger/OpenAPI全部通过。
- 部署后运行中API纯元数据核对：三字段required=false，requiredOnCreate保留其他六项，requiredAlways=[divisionId]；不访问业务数据。
- 部署后真实Chrome验证再次通过（4.7s，所有API请求拦截），不提交生产测试记录。
- git push github HEAD:main成功，远程由a979d3b更新至6c9b227；无冲突/强推。
- 页面：http://192.168.1.249:15172/master-plan-system/mps-shipping-plans
- 结论：修复、测试、备份、部署门禁及正式部署完成。生产真实Excel导入/业务记录写入验收依用户要求未执行。

## 修改文件

API config.ts/config.spec.ts、application.service.spec.ts、spreadsheet.service.ts、shipping-optional.spec.ts；Contracts index.ts；Web MasterPlanPages.spec.tsx、e2e/master-plan-shipping-optional.spec.ts；docs/mps-shipping-optional-fields.md。

源码提交仅含本任务9文件，原先outputs/CODEX_PROGRESS.md和FINANCE_ORDER_POSTGRES_VALIDATION.json的未提交内容保留。

2026-10-20文档同步补记：用户要求同步四份输出记录；本技术验收文档现纳入Git提交，既有生产部署结果不变，本次不部署或导入业务数据。

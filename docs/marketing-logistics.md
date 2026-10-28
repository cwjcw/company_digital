# 营销中心物流台账

## 入口与合同

入口：营销中心 → 物流 → 物流台账，`/marketing/logistics-ledger`。
资源：`logistics-ledger`，归属 `marketing`。字段、筛选能力、打印和权限配置复用 Contracts 注册及 KdosDataTable。

模板严格保留原17列，右侧追加物流单号、客户、物流负责人、出运日期、费用合计、订单号，共23列。数量、装箱量（PCS/箱）、净重和毛重（单箱重量）原值保存。只有物流单号新增必填；空订单有效。

## 数据与命令

Migration：`database/migrations/0019_marketing_logistics.sql`，复用 KDOS SQL migration runner。

- `marketing.logistics_shipments`：整柜字段、六项费用、数据库生成的 `total_fee`，租户内物流单号唯一。
- `marketing.logistics_details`：款号明细及可空订单号，租户与主表ID复合外键。
- `marketing.logistics_imports`：文件哈希、命令幂等结果，不保存原始Excel。
- `marketing.logistics_ledger_rows`：安全调用者视图，一行一款号，包含同柜去重订单汇总。

三表均有 UUIDv7、租户、审计字段和版本；启用并强制RLS，事务解析租户编码后设置上下文。修改任何同柜字段或明细都会递增整柜版本，旧版本返回409。共用字段修改需覆盖整柜的编辑数据范围；批量删除先检查所有版本再执行。删除最后一条明细时删除对应空主表，审计保留删除前主表和明细。

所有网页及Excel写入走 LogisticsApplicationService Commands，主表、明细、幂等和审计在同一事务内提交；不覆盖旧单号。生产迁移遵循既有备份及migration runner，执行证据记录在进度文件。应用回退时保留三表及审计，不自动删除已有物流数据。

## 权限与关联

- 系统管理员及营销模块管理员沿用原框架；费用合计任何人都不能写。
- 普通用户需要资源操作授权和各字段 `read` / `update` 授权；只有六项费用都可读且费用合计自身可读，才能获得合计，防止反推未授权费用。隐藏费用不可筛选、排序、导出、打印或获取汇总。
- 读取按现有数据范围；可靠关联订单的业务员额外可读整柜全部款号。关联来自同租户 `marketing.order_schedules.order_number`、`status='NORMAL'` 与 `salesperson_user_ids`。仍需物流资源与对应字段查看权限；共享不授予编辑或费用权限。
- 导出范围为 read ∩ export。共享不扩大 export 授权范围。
- 客户使用现有 `marketing.business_customer_mappings.customer_code`（租户唯一）匹配，显示/导入均使用编码；当前不按客户名称猜测匹配，不创建客户。
- 成员使用当前租户的 KDOS `users.id`。导入可使用用户ID、登录名、工号或唯一姓名，姓名歧义报错；停用用户保留显示但不可新选。导出使用“姓名 (登录名)”以安全重识别。

## API

| 方法 | 路径（前缀 `/api/v1`） | 用途 |
| --- | --- | --- |
| GET | `/table-filters/rows?resource=logistics-ledger` | 标准分页、搜索、筛选、排序与字段裁剪 |
| GET | `/marketing/logistics-ledger/summary` | 当前搜索/FilterGroup范围按整柜去重汇总，只返回可读费用 |
| GET | `/marketing/logistics-ledger/references` | 有权使用的现有客户与同租户成员 |
| POST | `/marketing/logistics-ledger` | 新增 `{values,commandKey}`，重复点击幂等 |
| PATCH | `/marketing/logistics-ledger/:detailId` | `{values,expectedVersion}`，主/明细字段分别维护 |
| POST | `/marketing/logistics-ledger/:detailId/details` | 同柜增加款号，提交明细字段与主版本 |
| POST | `/marketing/logistics-ledger/delete` | `{rows:[{id,expectedVersion}]}` 原子批量删除 |
| GET | `/marketing/logistics-ledger/import-template` | 23列模板 |
| POST | `/marketing/logistics-ledger/import-preview` | multipart `file`，xls/xlsx预览 |
| POST | `/marketing/logistics-ledger/import-confirm` | `{token}`，人工确认并重新校验权限/关联/重复 |
| GET | `/table-exports/logistics-ledger` | 平台服务端Excel导出全部匹配记录 |
| GET/POST | `/table-prints/manifest`、`/table-prints/render` | 原有标准打印协议 |

## Excel与费用

新增 `@e965/xlsx@0.20.3` 只用于读取旧xls及xlsx；导出继续使用平台ExcelJS。文件最大20MB、明细最多10000行；前5行按正式字段名识别表头，支持第2行表头。解析前调用统一加密检测，含旧xls FILEPASS；加密文件原样提示“该文件被加密,请解密后再导入.”。

相同物流单号合并为一个主记录，非空共用值必须一致；空白可继承同组已填值。重复相同费用只记录一次，不求和；费用合计忽略上传值/公式，由数据库精确numeric计算。六项全空时合计NULL，有显式0时保留0。冲突的行号、字段及原始值保留在预览；疑似重复明细提示后拒绝确认。整文件错误不部分写入，重复文件、并发重复确认及已存在单号均有保护。

**业务专属受控导入例外**：用户明确23列及已有单号拒绝覆盖，本资源导入仅新增，不套用通用ID/version混合更新模板。页面更新仍强制版本。导出重导已有单号明确拒绝；不能用于静默覆盖。

页面共用字段是整柜金额；底部汇总按shipment_id去重。平台打印及导出在匹配结果中每柜仅输出一次费用，不因款号或订单重复。按订单筛选得到的是关联整柜费用，本期不分摊。

## 本地验收

针对性Jest、React组件、Contracts/Schema、Node24类型/构建及Chrome验收结果见 `test/logistics/acceptance.md` 与 `outputs/CODEX_PROGRESS.md`。隔离数据库使用独立临时容器，不接入项目.env、不写生产数据。可复现 PostgreSQL 测试：在已应用本项目SQL迁移的本机专用 `kdos_logistics_test` 数据库端口15439上运行：

```bash
KDOS_LOGISTICS_LOCAL_TEST=true pnpm --filter @tracker/api exec jest --runInBand --testPathPatterns=marketing/logistics.postgres.spec
```

该测试明确连接loopback和专用库名，会清理该专用测试库中的营销测试数据，不接受生产数据库配置。

本期无ERP同步、通知或定时任务。2026-10-28用户追加授权部署并推送GitHub；上线版本、迁移及生产验收结果以outputs/CODEX_PROGRESS.md发布记录为准。

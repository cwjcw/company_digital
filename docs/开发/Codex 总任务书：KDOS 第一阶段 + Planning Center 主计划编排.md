# KDOS 第一阶段重构 + Planning Center 主计划编排开发任务

你当前位于“凯南计划中心 Web 项目”源码根目录。

当前项目原名/包名可能为：

`four-department-tracker`

现在需要正式将它升级为：

# Kainan Digital OS

简称：

`KDOS`

中文名称：

**凯南数字化工作台**

当前项目不是完全从零开始。

已经存在一个较完整的主计划/月度计划表格页面，包括：

- 双层表头
- 约 97 个 Web 字段
- AG Grid Community
- 横向虚拟滚动
- 编辑
- 筛选
- 字段显示
- 工序字段
- 图片
- Excel 导入导出
- 部分计划业务逻辑
- Socket.IO
- PostgreSQL
- NestJS
- React

这些已有成果必须尽可能保留。

但是：

> 当前业务数据没有保留价值，可以删除并重新建立数据库。

因此本次允许：

- 重建数据库
- 重建 Schema
- 调整 ORM
- 修改 API
- 调整工程目录
- 修改认证架构
- 删除不合理的旧数据模型

但：

> **绝对不能在没有备份和迁移验证的情况下丢失现有主计划表格 UI、字段定义、交互逻辑、Excel字段映射和已完成的业务规则。**

---

# 一、最终目标

本任务必须至少完成两个目标。

## 目标 A：KDOS 重构第一阶段

把现在的独立计划系统升级为：

```text
Kainan Digital OS
│
├── Platform Foundation
│
└── Planning Center
```

建立能够长期承载：

```text
计划中心
项目中心
BI
知识库
表格中心
预算中心
审批中心
AI
ERP/WMS/MES/PLM集成
```

的正式工程底座。

---

## 目标 B：Planning Center 主计划编排 V1

已有 AG Grid 主计划表必须迁移到新架构中，并成为真正的：

> **生产主计划编排中心**

而不仅仅是一张 Web 表格。

V1 至少支持：

```text
计划月份
计划版本
计划订单
计划品号
生产数量
交期
工序
工序交期
状态
异常
负责人/责任组织
计划编排
批量修改
计划发布
计划锁定
计划快照
修改历史
并发编辑
计划查询
```

---

# 二、工作原则

必须遵守：

1. 先备份，再重构。
2. 真实源码优先于本文档。
3. 已有表格 UI 和业务经验优先复用。
4. 当前业务数据可以全部删除。
5. 不需要兼容旧数据库数据。
6. 数据库允许重新设计。
7. 不需要维护无价值的旧 API 兼容。
8. 不为了重构而重写已经工作良好的 UI。
9. AG Grid Community 必须保留。
10. React、Ant Design、TanStack Query 保留。
11. NestJS 保留。
12. PostgreSQL 18 保留。
13. TypeORM 可以迁移到 Drizzle。
14. Node.js 目标升级为 Node.js 24 LTS。
15. 所有业务写操作统一经过 Application Service。
16. Controller 禁止直接访问数据库。
17. 前端禁止直接访问数据库或外部 ERP。
18. AI 未来只能访问业务 Service/API。
19. 所有核心业务对象从第一天具有 tenant_id。
20. 所有关键修改具有审计记录。
21. 关键业务记录使用 optimistic locking。
22. 不引入 Kubernetes。
23. 不引入 Kafka。
24. 不引入 RabbitMQ。
25. 不引入 ClickHouse。
26. 不进行微服务拆分。
27. 不进行微前端拆分。
28. 不实现复杂 APS 自动排产算法。
29. 不为了未来需求制造大量无实际用途的抽象。
30. 所有架构修改必须以长期可维护性为目的。

---

# 三、Phase 0：必须先完整备份现有项目

开始任何重构前，先执行源码和工作区审查。

首先检查：

```bash
git status
git diff --stat
git diff
```

不得执行：

```bash
git reset --hard
git clean -fd
git restore .
```

不得覆盖未提交代码。

建立：

```text
docs/migration/pre-kdos-baseline.md
```

记录：

- 当前 Git commit
- 当前 branch
- 未提交修改
- Node版本
- pnpm版本
- 当前目录结构
- 当前数据库方式
- 当前主要功能
- 当前主要页面

---

## 创建源码备份

必须建立一个仓库之外的完整源码备份。

自动判断操作系统并选择合理的：

```text
zip
tar.gz
```

方式。

不需要备份：

```text
node_modules
dist
build
.git objects
数据库持久化目录
大型临时文件
```

但必须备份：

```text
apps
packages
data-operations
scripts
docs
package.json
pnpm-lock.yaml
docker-compose
.env.example
migration
```

如果存在未提交修改，另外生成：

```text
pre-kdos-worktree.patch
```

---

# 四、对现有主计划进行专项备份

这一步非常重要。

现有主计划 UI 是必须保留的资产。

必须扫描现有代码并生成：

```text
docs/migration/legacy-master-plan-inventory.md
```

内容至少包括：

```text
所有主计划字段
字段代码
字段中文名
字段类型
列宽
字段顺序

第一层表头
第二层表头

工序字段

编辑器
renderer
formatter

筛选规则
颜色规则
状态规则

字段权限

Excel列映射

前端计算逻辑

后端计算逻辑
```

如果当前系统可以运行：

使用 Playwright 保存：

```text
docs/migration/screenshots/
```

至少包括：

```text
master-plan-before.png

monthly-plan-before.png
```

作为迁移后的 UI 对照。

---

# 五、先执行旧项目基线测试

运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

如果环境支持：

```bash
pnpm test:e2e
pnpm test:tplus-sync
```

结果记录：

```text
docs/migration/pre-kdos-test-baseline.md
```

使用：

```text
PASS
FAIL
SKIPPED
```

明确区分。

不得因为测试无法运行而虚构 PASS。

---

# 六、正式更名为 KDOS

项目目标名称：

```text
kainan-digital-os
```

显示名称：

```text
凯南数字化工作台
```

规划中心模块：

```text
Planning Center
计划中心
```

已有代码不要求机械地一次改掉所有历史命名。

但新的代码、模块和文档统一使用：

```text
KDOS
Planning
```

---

# 七、目标 Monorepo

把现有仓库整理为：

```text
kainan-digital-os/

├── apps/
│
│   ├── web/
│   │   └── React 前端
│   │
│   ├── api/
│   │   └── NestJS API
│   │
│   ├── worker/
│   │   └── 异步任务
│   │
│   └── mcp/
│       └── AI MCP，第一阶段可以只建立骨架
│
├── packages/
│
│   ├── contracts/
│   │
│   ├── database/
│   │
│   ├── auth/
│   │
│   ├── permissions/
│   │
│   ├── canonical-model/
│   │
│   ├── integration-sdk/
│   │
│   ├── workflow-sdk/
│   │
│   ├── plugin-sdk/
│   │
│   ├── ai-tool-sdk/
│   │
│   ├── ui/
│   │
│   └── config/
│
├── modules/
│
│   ├── organization/
│   ├── permission/
│   ├── audit/
│   ├── integration/
│   ├── workflow/
│   └── planning/
│
├── integrations/
│
│   ├── tplus/
│   ├── wecom/
│   └── adapters/
│
├── database/
│
│   ├── migrations/
│   ├── seeds/
│   └── policies/
│
├── infra/
│
│   ├── docker/
│   ├── nginx/
│   ├── postgres/
│   └── keycloak/
│
├── docs/
│
├── scripts/
│
├── AGENTS.md
├── ARCHITECTURE.md
├── SECURITY.md
└── README.md
```

不要为了完全符合目录而建立几十个空模块。

只有真实需要时才建立。

---

# 八、前端目标结构

把目前大量集中在：

```text
apps/web/src/App.tsx
```

的业务代码拆分。

最终：

```text
apps/web/src/

├── app/
│   ├── router/
│   ├── layout/
│   └── providers/
│
├── modules/
│
│   └── planning/
│
│       ├── pages/
│       │   ├── PlanningDashboardPage.tsx
│       │   ├── MasterPlanPage.tsx
│       │   ├── MonthlyPlanPage.tsx
│       │   └── DailyProgressPage.tsx
│       │
│       ├── grid/
│       │   ├── column-registry.ts
│       │   ├── column-builder.ts
│       │   ├── renderers/
│       │   └── editors/
│       │
│       ├── components/
│       ├── hooks/
│       ├── api/
│       └── model/
│
└── shared/
```

最终：

```text
App.tsx
```

只负责：

```text
Provider
Router
Layout
```

禁止继续承载大量 Planning 业务代码。

---

# 九、现有 AG Grid 必须保留

主计划继续使用：

```text
AG Grid Community
```

不要迁移 Univer。

现有：

```text
双层表头
虚拟滚动
冻结列
过滤
编辑
renderer
颜色
字段顺序
```

必须迁移。

迁移后尽可能保持：

```text
功能一致
布局一致
字段一致
交互一致
```

视觉可以优化。

但不能因为重构减少功能。

---

# 十、主计划表改为 Metadata Driven

不要继续把约 97 个字段全部硬编码在页面。

建立：

# Planning Field Registry

字段模型至少：

```text
code

label

groupCode
groupLabel

dataType

width

order

visible

editable

sortable

filterable

required

permissionCode

rendererType

editorType

sourceType
```

例如：

```typescript
{
  code: "deliveryDate",
  label: "交期",
  groupCode: "sales",
  groupLabel: "销售",
  dataType: "date",
  width: 120,
  editable: true,
  filterable: true,
  permissionCode: "planning.plan.delivery_date"
}
```

然后：

```text
Field Registry
      ↓
Permission
      ↓
Column Builder
      ↓
AG Grid ColumnDefs
```

旧字段必须全部迁移进去。

---

# 十一、不要盲目把所有字段放数据库

字段分成：

```text
CORE
PROCESS
CALCULATED
DISPLAY
INTEGRATION
EXTENSION
```

其中核心强类型业务字段：

必须作为正式数据库字段。

例如：

```text
orderNumber

itemNumber

quantity

productionQuantity

deliveryDate

customer

status
```

工序类动态字段：

不要给每个工序不停新增数据库列。

使用：

```text
process_definitions

process_progress
```

实现。

计算字段：

尽量不要重复保存。

通过 Domain/Query Service 计算。

---

# 十二、工序必须配置化

现有约 14 个工序必须迁移。

建立：

```text
planning.process_definitions
```

至少：

```text
id
tenant_id

code
name

sequence

enabled

required_days_enabled
due_date_enabled
status_enabled
exception_enabled

status_strategy

created_at
updated_at
```

工序运行数据：

```text
planning.process_progress
```

至少：

```text
id
tenant_id

plan_item_id
process_definition_id

required_days
planned_date
actual_date

planned_quantity
completed_quantity

status
exception

version

updated_at
updated_by
```

唯一约束：

```text
plan_item_id
+
process_definition_id
```

---

# 十三、重新设计 Planning Domain

至少建立以下核心对象：

```text
PlanPeriod

PlanVersion

SalesOrder

SalesOrderLine

PlanItem

ProcessDefinition

ProcessProgress

DailyProgress

PlanSnapshot

PlanChange

ImportJob
```

不要因为旧实体名称存在就强行沿用。

从业务语义重新设计。

---

# 十四、SalesOrder 和 PlanItem 必须分离

必须明确：

```text
SalesOrder
=
真实销售订单
```

```text
SalesOrderLine
=
销售订单品号
```

```text
PlanItem
=
计划中心对该订单品号的计划安排
```

关系：

```text
SalesOrder
    ↓
SalesOrderLine
    ↓
PlanItem
    ↓
ProcessProgress
```

以后 ERP 订单修改不等于直接修改主计划。

---

# 十五、PlanPeriod

建立：

```text
planning.plan_periods
```

例如：

```text
2026-08
2026-09
```

字段：

```text
id

tenant_id

year
month

status

current_version_id

created_at
created_by

updated_at
updated_by
```

唯一：

```text
tenant_id
+
year
+
month
```

---

# 十六、主计划必须增加 PlanVersion

这是第一阶段必须实现的新能力。

一个月份不能只有一份永远被覆盖的计划。

建立：

```text
planning.plan_versions
```

状态：

```text
DRAFT
PUBLISHED
LOCKED
ARCHIVED
```

例如：

```text
2026-08

v1 PUBLISHED
v2 DRAFT
```

---

# 十七、Planning Version 业务规则

## DRAFT

允许具有权限的计划人员编排。

## PUBLISHED

代表已经正式发布。

其他部门默认读取 Published Version。

## LOCKED

代表冻结。

重大修改不得直接操作。

未来通过：

```text
Change Request
+
Workflow
```

处理。

第一阶段暂时可以只阻止普通直接修改。

---

# 十八、实现发布功能

必须实现：

```text
发布计划
```

API：

```text
POST /api/v1/planning/periods/{periodId}/versions/{versionId}/publish
```

发布时：

1. 校验权限。
2. 校验版本状态。
3. 校验数据完整性。
4. 创建 Snapshot。
5. 将 Version 标为 PUBLISHED。
6. 更新 PlanPeriod.current_version。
7. 写 Audit。
8. 发布 Domain Event。

事件：

```text
planning.plan.published
```

---

# 十九、实现计划锁定

API：

```text
POST /api/v1/planning/periods/{periodId}/versions/{versionId}/lock
```

锁定后：

普通修改：

```text
403 / 409
```

不得继续静默修改。

事件：

```text
planning.plan.locked
```

---

# 二十、实现计划解锁接口

第一阶段仅管理员/高权限角色允许：

```text
planning.plan.unlock
```

必须填写：

```text
reason
```

写完整 Audit。

未来改为走 Workflow。

---

# 二十一、PlanSnapshot

正式发布时创建：

```text
planning.plan_snapshots
```

Snapshot 用于回答：

> 当时正式发布的计划到底是什么？

Snapshot 必须保存：

```text
version_id
snapshot_number
created_at
created_by
```

以及当时的核心计划数据。

实现方式可以：

```text
JSONB snapshot
```

或者：

```text
snapshot header + rows
```

请根据当前数据规模选择。

优先简单可靠。

---

# 二十二、不要把 Snapshot 和 optimistic version 混在一起

必须明确：

```text
row.version
```

用于：

> 并发控制。

```text
PlanVersion
```

用于：

> 计划业务版本。

```text
PlanSnapshot
```

用于：

> 正式历史快照。

三者职责不同。

---

# 二十三、PlanItem

重新设计核心计划行。

至少考虑：

```text
id
tenant_id

plan_version_id

sales_order_line_id

order_number
item_number

customer_code
customer_name

item_name
specification

order_quantity

production_quantity

historical_inbound_quantity
current_inbound_quantity

delivery_date

responsible_org_id
owner_user_id

priority

sequence

remark

version

created_at
created_by

updated_at
updated_by
```

不要为了匹配上面字段而删除已有重要业务字段。

真实字段应结合现有 97 列 inventory 进行设计。

---

# 二十四、增加计划编排字段

第一阶段主计划必须支持至少：

```text
priority

sequence

responsible organization

owner

planned quantity

delivery date

process planned dates

process required days

status

exception
```

允许计划员进行：

```text
单元格修改

批量修改

批量设置负责人

批量调整交期

批量设置状态

批量设置优先级
```

---

# 二十五、实现计划排序/编排顺序

不要完全依赖数据库 ID 或订单号决定计划顺序。

增加：

```text
sequence
```

支持：

```text
上移
下移
移动到顶部
移动到底部
批量调整顺序
```

如果当前 AG Grid 支持拖动且实现成本合理：

可以支持：

```text
Row Drag
```

但必须通过 API 保存 sequence。

不能只在浏览器变化。

---

# 二十六、计划编排不等于 APS

第一阶段明确不实现：

```text
有限产能自动排程

机器级排产

复杂约束求解

自动优化算法

OR-Tools APS
```

V1 是：

> **人工主计划编排 + 系统规则 + 风险提示。**

未来 APS 可以通过接口接入。

---

# 二十七、业务计算统一

现有：

```text
欠数
完成率
金额
工序状态
颜色
```

必须找到唯一权威来源。

建立：

```text
PlanningDomainService
```

或拆分：

```text
PlanQuantityPolicy

PlanCompletionPolicy

DeliveryRiskPolicy

ProcessStatusPolicy
```

前端禁止重新发明另一套算法。

---

# 二十八、数量和金额

所有：

```text
金额
数量
完成率
```

继续使用精确十进制。

数据库：

```text
numeric
```

业务：

```text
decimal.js
```

禁止依赖 JavaScript 浮点直接计算财务金额。

---

# 二十九、数据库技术调整

旧业务数据可以删除，因此：

> 新建干净的 KDOS 数据库。

优先不要在原数据库直接改。

例如：

```text
旧：
four_department_tracker

新：
kdos
```

旧数据库先保留，直到新系统验收。

---

# 三十、数据库 Schema

新数据库建立：

```text
iam

core

planning

workflow

integration

audit
```

第一阶段真正使用：

```text
iam
planning
audit
integration
```

workflow 可以建立基础表或接口。

不要创建大量无用途空表。

---

# 三十一、ORM 迁移到 Drizzle

允许移除 TypeORM。

目标：

```text
NestJS
 ↓
Repository Interface
 ↓
Drizzle Repository
 ↓
PostgreSQL
```

业务层禁止直接依赖 Drizzle。

例如：

```text
PlanItemRepository
```

实现：

```text
DrizzlePlanItemRepository
```

---

# 三十二、数据库 Migration

建立正式：

```text
packages/database
```

或合理等价结构。

Drizzle Schema 和 Migration 必须进入 Git。

不得使用：

```text
synchronize=true
```

作为生产数据库管理方式。

---

# 三十三、ID

所有 KDOS 内部业务主键：

```text
UUIDv7
```

业务编号另外存在：

```text
orderNumber
itemNumber
periodCode
```

不要使用业务编号作为数据库主键。

---

# 三十四、多租户

从第一天建立：

```text
iam.tenants
```

Seed：

```text
code = KAINAN
name = 凯南
```

所有 Planning 主表：

```text
tenant_id NOT NULL
```

不需要以后再补。

---

# 三十五、第一阶段开始加入 PostgreSQL RLS

至少为 Planning 的核心表建立 tenant RLS。

目标：

```text
PlanPeriod
PlanVersion
PlanItem
ProcessProgress
```

不同 tenant 不可能互相读取。

同时应用层仍必须做权限过滤。

RLS 是：

> 最后一层保护。

不是替代业务权限。

---

# 三十六、身份和认证

如果当前自建用户系统没有正式用户数据：

建议直接开始接入：

```text
Keycloak
```

目标：

```text
Browser
 ↓
Keycloak OIDC
 ↓
Access Token
 ↓
NestJS
```

Keycloak负责：

```text
Authentication
```

KDOS负责：

```text
Authorization
```

如果当前环境暂时不能顺利启动 Keycloak：

允许实现：

```text
AuthProvider Interface
+
LocalDevelopmentAuthProvider
+
KeycloakProvider
```

但是生产目标必须是 Keycloak。

---

# 三十七、IAM 数据模型

KDOS自身建立：

```text
iam.organizations

iam.departments

iam.positions

iam.employees

iam.users

iam.identities

iam.roles

iam.permissions

iam.role_permissions

iam.role_bindings

iam.field_policies
```

Keycloak ID 存：

```text
iam.identities
```

不要使用 Keycloak ID 作为业务主键。

---

# 三十八、权限模型

Planning 至少定义：

```text
planning.plan.read

planning.plan.create

planning.plan.update

planning.plan.delete

planning.plan.publish

planning.plan.lock

planning.plan.unlock

planning.plan.import

planning.plan.export

planning.plan.move

planning.process.read

planning.process.update

planning.progress.read

planning.progress.update

planning.admin.manage
```

---

# 三十九、字段权限

字段必须支持：

```text
HIDDEN
READONLY
EDITABLE
MASKED
```

AG Grid 列的：

```text
visible
editable
```

由：

```text
Field Registry
+
Permission Engine
```

动态决定。

但：

> 后端仍必须再次校验字段修改权限。

不能只依赖前端。

---

# 四十、Application Service

所有写入口：

```text
Web编辑
批量修改
Excel导入
T+同步
系统任务
未来AI
```

最终必须走：

```text
Application Command
 ↓
Domain
 ↓
Repository
```

禁止不同入口直接操作数据库。

---

# 四十一、Excel 导入迁移

已有 Excel 导入逻辑尽量保留解析经验。

但最终数据写入必须走：

```text
Upload
 ↓
Parse
 ↓
Normalize
 ↓
Validate
 ↓
Preview
 ↓
Confirm
 ↓
Application Command
 ↓
Domain
 ↓
Database
```

Excel Service 禁止直接完成所有业务 INSERT。

---

# 四十二、T+ 重构为 Integration Adapter

建立：

```text
SalesOrderProvider
```

T+：

```text
TPlusSalesOrderAdapter
```

关系：

```text
Planning
 ↓
SalesOrderProvider
 ↓
TPlusSalesOrderAdapter
 ↓
T+
```

Planning 模块不能依赖：

```text
T+ SQL文件
```

---

# 四十三、建立 Canonical Model

Planning 当前需要：

```text
CanonicalSalesOrder

CanonicalSalesOrderLine

CanonicalItem

CanonicalCustomer

CanonicalSupplier
```

T+ 数据：

```text
T+
 ↓
Adapter Mapping
 ↓
CanonicalSalesOrder
 ↓
Planning
```

未来 E10 也映射相同模型。

---

# 四十四、Audit

建立：

```text
audit.audit_logs
```

至少保存：

```text
tenant_id

user_id

action

resource_type

resource_id

before

after

reason

source

request_id

trace_id

ip

created_at
```

主计划必须审计：

```text
修改字段

批量修改

发布

锁定

解锁

移动顺序

导入

系统滚动
```

---

# 四十五、并发编辑

保留现有：

```text
version
expectedVersion
HTTP 409
```

所有核心 PlanItem 修改继续使用 optimistic locking。

禁止静默 Last Write Wins。

---

# 四十六、Socket.IO

继续保留。

但业务 Service 不直接：

```text
socket.emit()
```

建立：

```text
DomainEventPublisher
```

事件至少：

```text
planning.plan_item.updated

planning.plan.reordered

planning.plan.published

planning.plan.locked

planning.plan.unlocked

planning.plan.imported
```

Socket.IO 订阅这些事件。

---

# 四十七、WebSocket 不广播完整敏感记录

优先广播：

```json
{
  "entityId": "...",
  "version": 7,
  "changeType": "updated"
}
```

客户端收到以后：

```text
TanStack Query invalidate
↓
重新调用 API
↓
API执行权限过滤
```

---

# 四十八、Planning Query Service

必须建立稳定的：

```text
PlanQueryService
```

至少支持：

```text
getPlanPeriod

getPublishedPlan

getDraftPlan

getPlanItem

searchPlanItems

getOrderProgress

getProcessProgress

getOverdueItems

getPlanRiskSummary
```

AG Grid、BI 和未来 AI 都通过这一层获取业务数据。

---

# 四十九、为 AI 预留 Tool Contract

第一阶段不需要完整 AI Chat。

但定义：

```text
planning.plan.search

planning.plan.get

planning.order.progress

planning.process.progress

planning.risk.summary
```

这些全部：

```text
READ ONLY
```

每个 Tool Definition 具有：

```text
name

description

inputSchema

outputSchema

permission

riskLevel

requiresConfirmation
```

不允许 AI Tool 直接访问 Drizzle 或 SQL。

---

# 五十、为审批预留 Workflow 边界

KDOS 未来使用统一 Workflow Center。

Planning 建立：

```text
WorkflowGateway
```

但第一阶段不要求把所有流程正式跑到 Flowable。

定义未来审批场景：

```text
planning.plan.publish

planning.plan.major_change

planning.delivery_date.change

planning.plan.unlock

planning.period.close
```

建立：

```text
docs/workflow/planning-workflows.md
```

---

# 五十一、普通修改与重大修改分开

不要让每个单元格修改都审批。

未来规则：

```text
普通业务修改
↓
直接更新
↓
Audit
```

重大修改：

```text
Change Request
↓
Workflow
↓
Approved
↓
真正修改计划
```

第一阶段先留接口和数据模型。

---

# 五十二、Planning Plugin Manifest

建立：

```text
planning.manifest.ts
```

至少：

```text
id

name

version

navigation

routes

permissions

events

workflows

aiTools
```

Planning 是 KDOS 的第一个正式业务模块。

---

# 五十三、主计划页面 V1 功能

重构完成后页面至少支持：

## 顶部

```text
月份选择

当前版本

版本状态

新建草稿版本

发布

锁定

解锁

导入

导出

字段设置
```

---

## 主表

必须保留已有表格结构。

支持：

```text
筛选

排序

固定列

横向虚拟滚动

双层表头

字段显示

单元格编辑

批量编辑

行选择

工序信息

状态

异常

图片
```

---

## 新增计划编排能力

支持：

```text
优先级

计划顺序

责任组织

负责人

计划数量

交期

工序所需天数

工序计划交期

状态

异常
```

---

# 五十四、主计划顶部增加版本状态提示

例如：

```text
2026年8月

当前：
v3 DRAFT
```

或者：

```text
v2 PUBLISHED
```

锁定：

```text
🔒 v2 LOCKED
```

用户必须明确知道正在编辑：

```text
草稿
```

还是查看：

```text
正式发布版
```

---

# 五十五、Published 默认只读

非计划管理员查看 Published Plan：

默认：

```text
readonly
```

如果需要修改：

创建新的：

```text
DRAFT version
```

不要直接覆盖正式历史。

---

# 五十六、新版本创建

API：

```text
POST /api/v1/planning/periods/{periodId}/versions
```

允许：

```text
从空白创建
```

或者：

```text
从当前 Published Version 复制
```

推荐默认：

```text
复制当前正式版
→
建立新 Draft
```

---

# 五十七、不要复制所有业务实体

新 Version 复制时，要根据合理的数据模型决定哪些属于：

```text
订单事实
```

哪些属于：

```text
计划版本数据
```

SalesOrder 不应复制。

PlanItem 的版本化计划数据可以复制。

---

# 五十八、计划风险基础能力

第一阶段增加基础：

```text
交期逾期

即将到期

工序逾期

异常未关闭
```

不要做复杂 AI。

提供：

```text
PlanningRiskService
```

返回结构化结果。

以后 AI 和 BI 直接使用。

---

# 五十九、月初滚动重新实现为 Domain Use Case

现有算法如果正确可以迁移。

但最终：

```text
MonthlyRolloverService
```

必须通过 Planning Application Service 创建新月份/新版本。

不得直接批量复制数据库绕过：

```text
权限
业务规则
Audit
Event
```

系统任务可以拥有：

```text
SYSTEM actor
```

---

# 六十、旧数据库处理

不要立即删除旧数据库。

执行：

```text
OLD DATABASE
=
READ ONLY / BACKUP
```

新系统运行：

```text
NEW KDOS DATABASE
```

完成 UI 和功能验收后，再由用户决定是否删除旧库。

Codex 不得自行删除旧生产/开发数据库。

---

# 六十一、Docker Compose

第一阶段目标至少：

```text
kdos-web

kdos-api

kdos-postgres
```

如果完成 Keycloak：

```text
kdos-keycloak
```

可以加入。

暂时不要因为架构规划安装：

```text
Flowable
SeaweedFS
Valkey
RabbitMQ
ClickHouse
```

除非当前代码已经明确需要。

---

# 六十二、保留 ObjectStorage 抽象

当前文件可以继续：

```text
LocalObjectStorage
```

接口：

```typescript
interface ObjectStorage {
  put(...)
  get(...)
  delete(...)
}
```

以后换：

```text
SeaweedFS
```

Planning 无需修改。

---

# 六十三、测试要求

必须增加/保留以下测试。

## Planning Domain

```text
欠数

完成率

金额

风险状态

工序状态
```

## Plan Version

```text
创建Draft

Published不能普通修改

发布

锁定

解锁

从Published复制Draft
```

## Optimistic Lock

```text
正确version成功

错误version 409
```

## Permission

```text
read

update

publish

lock

unlock

field permission
```

## Process

```text
process definition

progress unique constraint

动态工序
```

## Import

```text
解析

预览

确认

重复确认

事务回滚
```

## T+

```text
canonical mapping

双账套

幂等
```

---

# 六十四、UI 回归测试

如果旧页面能够运行：

使用 Playwright 进行：

```text
before
vs
after
```

至少验证：

```text
双层表头仍存在

主要字段仍存在

工序仍存在

横向滚动正常

编辑正常

筛选正常

批量修改正常
```

保存新截图：

```text
master-plan-after.png
```

---

# 六十五、必须建立 AGENTS.md

将以下核心规则写入：

```text
Controller不能访问数据库。

Controller只能调用Application Service。

Domain不得依赖NestJS Controller。

业务模块不得直接依赖Drizzle。

业务模块不得直接访问外部ERP。

外部系统必须通过Integration Adapter。

Planning不得直接访问T+ SQL。

AI Tool不能访问数据库。

AI Tool只能调用Application Service。

所有Planning核心表具有tenant_id。

所有关键写操作必须Audit。

所有协同实体必须使用version。

所有Published/Locked状态修改必须验证状态机。

前端隐藏按钮不是权限。

后端必须重新校验权限。

所有金额和数量使用精确十进制。

所有外部写入必须考虑幂等。

所有Event Consumer必须幂等。

不得引入Kafka。

不得引入Kubernetes。

不得引入微服务。

不得随意新增数据库。

不得随意新增基础设施。

不为了架构漂亮而制造空抽象。
```

---

# 六十六、实施顺序

必须严格分阶段，不要一次性改几百个文件。

## Step 0

```text
备份
现状审查
截图
字段Inventory
测试Baseline
```

## Step 1

```text
建立KDOS目录结构
拆App.tsx
拆controllers
Planning模块化
```

完成后测试。

## Step 2

```text
建立新kdos数据库
Drizzle
Schema
Tenant
Planning核心模型
```

完成后测试。

## Step 3

```text
迁移旧AG Grid
迁移97字段
Field Registry
Process Definition
```

完成 UI 对比。

## Step 4

```text
实现PlanPeriod
PlanVersion
PlanItem
PlanSnapshot
```

## Step 5

```text
实现主计划编排
批量修改
排序
负责人
责任组织
```

## Step 6

```text
实现发布
锁定
解锁
Snapshot
Audit
```

## Step 7

```text
迁移Excel
T+ Adapter
Canonical Model
```

## Step 8

```text
Query Service
AI Tool Contracts
Workflow Gateway
```

最后完整测试。

---

# 六十七、不要因为某一小项无法完成而停止整个任务

如果：

```text
Keycloak环境暂时不可用
```

不要停止。

建立接口和配置，继续 Planning。

如果：

```text
T+服务器当前不可连接
```

使用已有 Mock/Test 数据完成 Adapter。

如果：

```text
旧E2E测试依赖旧数据库
```

记录原因，并建立新数据库测试。

只在：

> 存在可能导致源码或不可恢复数据丢失的操作

时跳过该操作。

不要因为小问题要求用户反复确认。

---

# 六十八、本阶段 Definition of Done

本阶段只有满足以下条件才算完成。

## KDOS Foundation

必须至少完成：

```text
项目正式成为KDOS结构

Planning为独立模块

App.tsx不再承担大量Planning业务

controllers.ts不再承担全部业务

新PostgreSQL数据库

Drizzle Schema

tenant

权限基础

Audit基础

Integration Adapter接口

Plugin Manifest

Workflow Gateway接口

AI Tool Contract
```

---

## Planning Center

必须至少完成：

```text
旧主计划表成功迁移

双层表头保留

原重要字段保留

工序保留

编辑保留

筛选保留

字段显示保留

虚拟滚动保留

PlanPeriod

PlanVersion

Draft

Published

Locked

PlanItem

ProcessDefinition

ProcessProgress

计划顺序

计划优先级

批量编排

计划发布

计划锁定

计划解锁

Snapshot

Audit

Optimistic Lock

基础Risk Query
```

---

# 六十九、验收场景

必须能完整演示：

## 场景1

创建：

```text
2026年9月
```

计划周期。

---

## 场景2

导入/创建若干销售订单品号。

---

## 场景3

创建：

```text
2026-09 v1 DRAFT
```

---

## 场景4

计划员在 AG Grid 中：

```text
调整生产数量

调整交期

设置负责人

设置工序交期

设置优先级

调整计划顺序
```

---

## 场景5

两个用户同时修改同一条记录。

第二个过期修改返回：

```text
409 Conflict
```

---

## 场景6

计划员：

```text
发布v1
```

系统：

```text
创建Snapshot
写Audit
产生Event
```

---

## 场景7

基于 v1：

```text
创建 v2 DRAFT
```

继续调整。

v1 历史保持不变。

---

## 场景8

锁定正式版本。

普通用户不能继续修改。

---

## 场景9

查询：

```text
哪些订单已经逾期？

哪些工序存在异常？

哪些计划未来7天到期？
```

PlanQueryService 能返回结构化结果。

---

# 七十、最终报告

完成后必须输出：

# 1. 原项目情况

真正读取源码后发现了什么。

---

# 2. 备份位置

包括：

```text
源码备份
patch
旧数据库
截图
字段inventory
```

---

# 3. 实际架构变化

包括：

```text
前端
后端
数据库
权限
Integration
Planning
```

---

# 4. 数据库模型

列出：

```text
Schema
Table
主要关系
唯一约束
索引
RLS
```

---

# 5. Planning V1 已实现功能

逐项：

```text
DONE
PARTIAL
NOT DONE
```

---

# 6. 原主计划迁移情况

列：

```text
字段总数

成功迁移

未迁移

原因

工序

交互

UI差异
```

---

# 7. 测试

逐条：

```text
PASS
FAIL
SKIPPED
```

---

# 8. Git Diff Summary

说明：

```text
新增多少文件
删除多少文件
修改多少文件
核心变动
```

---

# 9. 风险

分类：

```text
P0
P1
P2
```

---

# 10. 下一阶段推荐

只给最重要的 10 项以内。

不要继续无限扩展范围。

---

# 最重要的最终原则

本次开发不是：

> 把现有主计划重新写一次。

而是：

> **把现有主计划保留下来，并正式升级为 Kainan Digital OS 的第一个核心业务模块。**

长期架构必须满足：

```text
                  Planning Domain
                         │
                         ▼
                  PlanQueryService
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
       AG Grid           BI             AI
          │
          ▼
   Application Service
          │
          ▼
       Domain
          │
          ▼
      Repository
          │
          ▼
     PostgreSQL
```

同时外部系统：

```text
T+
ERP
WMS
MES
PLM
     │
     ▼
Integration Adapter
     │
     ▼
Canonical Model
     │
     ▼
Planning
```

未来审批：

```text
Planning
 ↓
WorkflowGateway
 ↓
KDOS Workflow Center
```

任何前端、AI、Excel、ERP 集成都不能绕过业务层直接修改 Planning 数据。

现在开始执行。

第一步必须是：

**备份现有源码、现有主计划 UI 和字段定义。**

然后再进入 KDOS 重构。
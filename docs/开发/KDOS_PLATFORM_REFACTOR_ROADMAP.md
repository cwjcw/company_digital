
# KDOS 平台化改造总目标与实施进度

> 文件路径：`/data/automation/code/work/PMC/knweb/docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`
>
> 本文件是 KDOS 平台化改造的唯一总控文档。
>
> 从本文件建立之后，所有涉及 UI Schema、Resource Schema、通用 CRUD、表单引擎、权限、插件、流程引擎、Flowable、工作中心等平台能力的开发任务，在完成后都必须同步更新本文件。
>
> **任何 Codex 会话开始相关改造前，必须先阅读本文件；任务结束前，必须更新本文件。**

---

# 1. 改造背景

KDOS 当前已经从单一业务系统逐步发展为企业数字化平台，已经具备：

- React + TypeScript 前端
- Ant Design
- AG Grid
- ECharts
- TanStack React Query
- NestJS
- TypeORM
- PostgreSQL
- 权限体系
- 组织架构
- 多业务模块
- Notification Dispatcher
- `@kdos/contracts`
- `@kdos/permissions`
- `@kdos/plugin-sdk`
- `@kdos/workflow-sdk`
- `KdosDataTable`
- 审批流程配置
- 部分业务模块自己的 Workflow 状态机

随着后续继续建设：

- 任务督办
- 订单项目管理
- CRM
- HR
- 全面预算
- 主计划
- 设备管理
- 数据中台
- 审批流程
- 企业微信消息
- AI 能力

如果继续由每个业务模块独立开发：

- 表格
- 表单
- Modal
- Drawer
- CRUD
- 字段定义
- 权限
- 审批状态机
- 审批历史
- 消息通知

将造成大量重复代码和越来越高的维护成本。

因此开始 KDOS 平台化改造。

---

# 2. 总目标

KDOS 最终目标不是建设一个普通低代码平台，而是建设：

> **面向凯南企业数字化的元数据驱动企业应用平台。**

最终业务模块应主要描述：

1. 这个模块有哪些资源；
2. 每个资源有哪些字段；
3. 字段如何显示和编辑；
4. 谁可以访问；
5. 有哪些业务动作；
6. 需要走什么流程；
7. 会产生什么事件；
8. 需要发送什么通知；
9. 可以提供哪些 AI 工具。

而不是每增加一个模块重新开发整套后台基础能力。

---

# 3. 最终目标架构

```text
                         KDOS
                           │
              ┌────────────┴────────────┐
              │                         │
         Platform Core             Business Plugins
              │                         │
              │               ┌─────────┼─────────┐
              │               │         │         │
              │             主计划     设备     任务督办
              │               │         │         │
              │              CRM       HR       项目管理
              │
 ┌────────────┼────────────────────────────────────┐
 │            │             │          │           │
Schema     Permission    Workflow     Event    Notification
Engine       Engine       Gateway      Bus        Engine
 │            │             │
 │      @kdos/permissions   │
 │                          │
 │                    Flowable Adapter
 │                          │
 │                       Flowable
 │
UI Engine
 │
 ├── KdosDataTable
 ├── AG Grid
 ├── ProComponents
 ├── ECharts
 ├── KdosSchemaForm
 ├── KdosSchemaDetail
 └── Schema Renderer
```

---

# 4. 核心原则

## 4.1 不推翻现有 KDOS

以下技术和资产原则上保留：

- NestJS
- PostgreSQL
- TypeORM
- React
- React Query
- Ant Design
- AG Grid
- ECharts
- `KdosDataTable`
- `@kdos/contracts`
- `@kdos/permissions`
- `@kdos/plugin-sdk`
- `@kdos/workflow-sdk`
- Notification Dispatcher
- 现有业务模块
- 现有 API

改造原则为：

> 增量抽象、逐步迁移、兼容旧模块。

禁止为了“架构更漂亮”而整体重写已有生产功能。

---

# 5. 各开源项目的定位

## 5.1 ProComponents

定位：

> KDOS 通用后台表单、详情页和标准交互组件库。

重点考虑使用：

- ProForm
- ModalForm
- DrawerForm
- QueryFilter
- ProDescriptions
- ProCard
- StepsForm

主要解决：

- 重复 Form.Item
- Modal 表单
- Drawer 表单
- 查询表单
- 详情展示

不用于强行替换：

- KdosDataTable
- AG Grid
- 制造业复杂排期表
- 高度定制的业务页面

---

## 5.2 Refine

定位：

> 可选的 React CRUD / Data Provider 基础能力。

当前阶段：

**暂不全面接入。**

原因：

KDOS 已经存在：

- React Query
- `api()`
- platform rows
- KdosDataTable
- permissions
- contracts

如果现在全面接入 Refine，可能产生重复抽象。

未来仅选择简单资源做 PoC。

如果不能明显降低代码量，则不推广。

---

## 5.3 Flowable

定位：

> KDOS BPM / Workflow Runtime。

Flowable 负责：

- BPMN 流程定义
- 流程实例
- User Task
- Gateway
- 条件分支
- 并行流程
- 会签能力
- 流程变量
- 流程历史
- 流程版本
- Timer
- 子流程
- 流程运行状态

KDOS 负责：

- 用户
- 组织
- 租户
- 权限
- 业务数据
- 表单
- 页面
- 业务规则
- 消息
- 企业微信
- 工作中心

业务模块禁止直接强依赖 Flowable。

统一通过：

```text
Business Module
      ↓
@kdos/workflow-sdk
      ↓
WorkflowGateway
      ↓
FlowableAdapter
      ↓
Flowable
```

---

# 6. 现有核心资产处理原则

## 6.1 `@kdos/permissions`

状态：

**保留并继续强化。**

未来作为 KDOS 权限唯一真相源。

任何第三方 UI / CRUD 框架必须适配 KDOS 权限，而不是替代 KDOS 权限。

---

## 6.2 `@kdos/workflow-sdk`

状态：

**保留。**

未来定位调整为：

> 业务模块与具体 BPM 引擎之间的统一抽象层。

禁止继续把它发展为完整 BPMN 引擎。

---

## 6.3 `@kdos/plugin-sdk`

状态：

**重点强化。**

未来业务模块应逐步通过 Plugin Manifest 声明：

- navigation
- routes
- permissions
- resources
- events
- workflows
- aiTools

目标：

业务模块安装后，KDOS Core 能自动知道模块的基础能力。

---

## 6.4 `KdosDataTable`

状态：

**保留，但逐步拆分。**

禁止简单替换为 ProTable。

未来逐渐拆分：

```text
KdosDataTable
├── TablePermission
├── TableFilter
├── TablePrint
├── TableView
├── TableSelection
├── TableEdit
└── TableServerData
```

避免单个文件继续无限膨胀。

---

# 7. 最终 Resource 定义目标

未来业务资源应逐步采用统一定义，例如：

```ts
const TaskResource = {
  resource: "tasks",

  fields: [
    {
      name: "title",
      label: "任务名称",
      type: "text",
      required: true
    },
    {
      name: "ownerId",
      label: "责任人",
      type: "user",
      required: true
    },
    {
      name: "deadline",
      label: "要求完成时间",
      type: "datetime"
    },
    {
      name: "status",
      label: "状态",
      type: "select"
    }
  ]
};
```

同一套字段定义最终可服务：

- 列表
- 表单
- 详情页
- 查询
- 高级筛选
- 字段权限
- 导出
- 打印
- AI Tool Schema
- Workflow Form
- API Contract

但必须逐步实现，禁止一步完成全部功能。

---

# 8. 实施阶段

---

## Phase 0：建立改造治理机制

状态：`COMPLETED`

目标：

建立：

`docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md`

要求：

以后所有平台化相关开发任务都必须更新本文件。

完成条件：

- [x] 总控文件进入 Git
- [x] Codex 后续任务明确要求先读本文件
- [x] 每次任务完成更新任务状态
- [x] 每次任务完成增加 Change Log

---

# Phase 1：建立 `@kdos/ui-schema`

状态：`NOT_STARTED`

目标：

建立 KDOS 第一版 UI Schema / Resource Schema 基础类型。

第一版只建立 Schema Contract，不实现完整低代码系统。

计划新增：

```text
packages/ui-schema/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    └── index.spec.ts
```

第一阶段建议包含：

- `KdosFieldType`
- `KdosFieldSchema`
- `KdosOptionSchema`
- `KdosFormSchema`
- `KdosDetailSchema`
- `KdosTableSchema`
- `KdosResourceSchema`

第一版字段类型建议：

```text
text
textarea
number
boolean
date
datetime
select
multiSelect
user
organization
```

第一版只做：

- TypeScript 类型
- 基础校验辅助函数
- 测试
- 文档注释

第一版暂时不做：

- 自动建数据库表
- 自动生成 TypeORM Entity
- 自动生成 NestJS Controller
- 动态数据库结构
- 可视化 Schema Designer
- Flowable
- Refine
- ProComponents 大规模接入
- 现有页面迁移

完成条件：

- [ ] `@kdos/ui-schema` package 创建
- [ ] 可以被 workspace package 正常引用
- [ ] 核心 Schema 类型建立
- [ ] Schema 可以描述任务督办的主要字段
- [ ] 有单元测试
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm test` 通过
- [ ] 本文件更新

---

# Phase 2：建立 Schema Renderer

状态：`NOT_STARTED`

目标：

开发：

- `KdosSchemaForm`
- `KdosSchemaDetail`

优先让 Schema 自动生成：

- 新增表单
- 编辑表单
- 详情展示

初期使用：

- Ant Design
- 必要时引入 ProComponents

暂时不自动生成复杂 Table。

完成条件：

- [ ] Text
- [ ] Textarea
- [ ] Number
- [ ] Boolean
- [ ] Date
- [ ] DateTime
- [ ] Select
- [ ] User
- [ ] Organization
- [ ] 字段必填
- [ ] 字段只读
- [ ] 字段隐藏
- [ ] 基础权限适配
- [ ] 单元测试

---

# Phase 3：任务督办作为第一个 Schema PoC

状态：`NOT_STARTED`

目标：

任务督办模块作为第一套 Schema 驱动业务模块。

原则：

- 不改变现有业务语义
- 不一次性重写整个任务督办模块
- 优先迁移新增、编辑、详情
- 表格继续使用 KdosDataTable

验证：

- Schema 是否真正减少页面代码
- 字段定义是否能复用
- 权限是否容易适配
- 业务定制是否仍然方便

成功后才推广至其他模块。

---

# Phase 4：Plugin Manifest 增强

状态：`NOT_STARTED`

目标：

强化 `@kdos/plugin-sdk`。

增加候选能力：

```text
resources
schemas
workflowDefinitions
notificationDefinitions
```

让业务插件逐步统一注册：

- 菜单
- 路由
- 权限
- Resource
- Schema
- Workflow
- Event
- AI Tool

注意：

第一版禁止动态加载任意远程 JS 插件。

先做编译期 Manifest。

---

# Phase 5：Flowable 技术 PoC

状态：`NOT_STARTED`

目标：

部署独立 Flowable。

测试流程：

```text
任务延期申请
    ↓
任务发起人审批
 ├── 同意
 └── 拒绝
```

PoC 必须验证：

- Flowable Docker 独立部署
- NestJS 调用 Flowable REST
- 部署 BPMN
- 启动流程实例
- 查询用户任务
- 完成用户任务
- 流程变量
- 流程历史
- KDOS 用户和 Flowable Assignee 映射
- tenantId 隔离方案

暂时不迁移生产审批流程。

---

# Phase 6：Flowable Adapter

状态：`NOT_STARTED`

目标：

在：

`@kdos/workflow-sdk`

与 Flowable 之间增加适配层。

建议：

```text
packages/workflow-sdk
      ↓
apps/api workflow infrastructure
      ↓
FlowableWorkflowGateway
      ↓
Flowable REST
```

业务模块禁止直接调用 Flowable REST。

---

# Phase 7：统一“我的工作”

状态：`NOT_STARTED`

目标：

建立：

```text
我的工作
├── 我的待办
│   ├── 流程待办
│   └── 督办任务
├── 我发起的
├── 我已处理的
└── 抄送我的
```

必须保持概念区分：

```text
流程任务 ≠ 督办任务
```

但 UI 可以统一。

---

# Phase 8：旧审批流程逐步迁移

状态：`NOT_STARTED`

候选首个迁移：

`development-request.workflow.ts`

原则：

1. 先保证 Flowable PoC 成熟；
2. 保留原 API 契约；
3. 保留原业务数据；
4. 前端尽可能不改；
5. Workflow Runtime 替换为 Flowable；
6. 支持回滚。

禁止一次迁移全部审批流程。

---

# Phase 9：Resource CRUD 标准化

状态：`NOT_STARTED`

目标：

根据前面实际经验决定是否继续建设：

- Generic CRUD Service
- Generic Resource Controller
- Refine Data Provider
- Schema Table

必须经过真实模块 PoC 后决定。

禁止为了追求“全自动 CRUD”提前过度设计。

---

# 9. 当前明确不做的事情

现阶段禁止：

- 重写 KDOS
- 换掉 NestJS
- 换掉 PostgreSQL
- 换掉 React
- 换掉 KdosDataTable
- 全量接入 Refine
- 全量接入 Flowable
- 将所有 Entity 改成动态 Entity
- 建立动态数据库字段系统
- 建立完整低代码页面设计器
- 建立复杂拖拽 BPMN Designer
- 一次迁移所有旧模块
- 一次迁移所有审批流程

---

# 10. 每个任务的标准执行流程

所有后续平台改造任务必须遵循：

```text
1. 阅读本文件
      ↓
2. 阅读相关 AGENTS / SKILL / README
      ↓
3. 阅读相关现有代码
      ↓
4. 确认本次任务边界
      ↓
5. 实现
      ↓
6. 测试
      ↓
7. 更新本文件
      ↓
8. 输出本次变更摘要
```

---

# 11. Codex 更新本文件的规则

每次任务结束必须更新：

## 当前阶段

例如：

```text
Phase 1：IN_PROGRESS
```

或者：

```text
Phase 1：COMPLETED
```

状态统一使用：

- `NOT_STARTED`
- `IN_PROGRESS`
- `BLOCKED`
- `COMPLETED`

---

## 本次完成

格式：

```text
### TASK-001

任务：
建立 @kdos/ui-schema 基础包。

完成：

- 创建 packages/ui-schema
- 增加 FieldSchema
- 增加 ResourceSchema
- 增加测试

测试：

- pnpm typecheck：PASS
- pnpm test：PASS

未完成：

- Schema Renderer
- Task 模块接入
```

---

## 下一步

每次必须写清楚：

```text
Next Recommended Task:
TASK-002 - 建立 KdosSchemaForm 第一版。
```

禁止只写：

```text
后续继续优化。
```

---

# 12. 任务清单

| ID       | 阶段    | 任务                                  | 状态        |
| -------- | ------- | ------------------------------------- | ----------- |
| TASK-000 | Phase 0 | 建立平台改造总控文档                  | COMPLETED |
| TASK-001 | Phase 1 | 创建`@kdos/ui-schema` 基础 package  | NOT_STARTED |
| TASK-002 | Phase 2 | 创建`KdosSchemaForm`                | NOT_STARTED |
| TASK-003 | Phase 2 | 创建`KdosSchemaDetail`              | NOT_STARTED |
| TASK-004 | Phase 3 | 任务督办接入 Schema Form              | NOT_STARTED |
| TASK-005 | Phase 3 | 评估 Schema PoC 实际收益              | NOT_STARTED |
| TASK-006 | Phase 4 | 扩展 Plugin Manifest                  | NOT_STARTED |
| TASK-007 | Phase 5 | Flowable Docker PoC                   | NOT_STARTED |
| TASK-008 | Phase 5 | 任务延期 BPMN PoC                     | NOT_STARTED |
| TASK-009 | Phase 6 | FlowableWorkflowGateway               | NOT_STARTED |
| TASK-010 | Phase 7 | 我的工作统一模型设计                  | NOT_STARTED |
| TASK-011 | Phase 8 | development-request Flowable 迁移设计 | NOT_STARTED |
| TASK-012 | Phase 9 | 评估 Generic CRUD / Refine            | NOT_STARTED |

---

# 13. 当前进度

当前日期：

`2026-09-28`

当前阶段：

```text
Phase 0：COMPLETED
Phase 1：NOT_STARTED
```

当前任务：

```text
当前业务修复：KDOS-PROJECT-TASK-UX-PERM-001
项目/任务导航、权限、表格编辑与甘特图体验修复；代码提交 `51933a5`，正式部署待本次验收完成。
```

下一任务：

```text
TASK-001
创建 @kdos/ui-schema 第一版基础 package。
```

---

# 14. Architecture Decision Log

## ADR-001：不推翻 KDOS

决定：

继续使用现有：

- React
- NestJS
- PostgreSQL
- TypeORM
- KDOS 权限体系

原因：

现有系统已有大量生产功能和业务资产。

---

## ADR-002：KdosDataTable 不由 ProTable 替代

决定：

继续保留 KdosDataTable。

原因：

其已经包含大量 KDOS 专有能力：

- 权限
- 字段权限
- 高级筛选
- 打印
- 用户视图
- Server Data
- 编辑模式
- 审计字段

---

## ADR-003：Refine 暂不全面引入

决定：

未来通过 PoC 决定。

原因：

KDOS 已经存在 React Query 和自己的 API / Table 抽象，直接全面引入可能增加重复层。

---

## ADR-004：流程 Runtime 优先评估 Flowable

决定：

KDOS 不自行开发完整 BPMN Runtime。

业务模块通过 Workflow Gateway 接入流程 Runtime。

---

## ADR-005：UI Schema 优先于 Flowable

决定：

首先建立 Resource / UI Schema。

原因：

目前最直接的问题是大量重复表单、字段和页面结构代码。

---

# 15. 风险记录

## Risk-001：过度平台化

风险：

为了减少代码反而建立过于复杂的平台框架。

控制方法：

每项平台能力必须先通过真实业务模块 PoC。

---

## Risk-002：Schema 限制业务定制

风险：

Schema Renderer 最终无法处理复杂业务场景。

控制方法：

Schema 必须支持：

```text
默认自动生成
+
业务组件 override
```

不追求 100% Schema 化。

---

## Risk-003：Flowable 与 KDOS 用户权限重复

控制方法：

Flowable 只负责流程 Runtime。

组织、权限、用户的唯一真相仍然在 KDOS。

---

## Risk-004：改造影响现有生产系统

控制方法：

- 增量建设
- 新模块先试
- 旧模块后迁移
- 保持 API 兼容
- 每个阶段可独立回滚

---

# 16. Change Log

## 2026-09-27

### TASK-000

建立 KDOS 平台化改造总体方案。

确定：

- KDOS 不推翻重做；
- 建立 UI Schema；
- ProComponents 用于减少表单类样板代码；
- KdosDataTable 保留；
- Refine 暂缓全面接入；
- Flowable 作为 Workflow Runtime 重点候选；
- `@kdos/workflow-sdk` 作为流程适配层；
- `@kdos/plugin-sdk` 作为业务模块插件声明基础；
- 任务督办作为第一个 Schema PoC。

下一步：

`TASK-001 - 创建 @kdos/ui-schema 第一版基础 package。`

## 2026-09-28

### TASK-000 收口

完成：

- 总控文档改为实际 Git 路径 `docs/开发/KDOS_PLATFORM_REFACTOR_ROADMAP.md` 并已被 Git 跟踪；
- 明确后续相关任务必须先读本文件、完成后更新状态与 Change Log；
- Phase 0 / TASK-000 标记为 `COMPLETED`；
- 下一推荐任务仍为 TASK-001，本次未启动。

### KDOS-PROJECT-TASK-UX-PERM-001（业务修复记录）

已完成代码与测试：

- `apps/web/src/App.tsx`：项目与任务导航三组子节点提升为模块顶层，保留原路由与资源码；
- `apps/web/src/modules/portal/ModulePortal.tsx`：移除顶栏角色身份文字，保留头像、显示名、用户名与退出操作；
- `apps/api/src/common/filtering/data-scope.ts` 与监督范围：恢复 `OWN=created_by`，增加 JSONB 成员数组 `CONTAINS CURRENT_USER` 的通用编译能力；
- `apps/web/src/modules/supervision/SupervisionPages.tsx`：项目/任务按字段类型内联编辑，使用现有 Application Command、版本校验、审计与缓存更新；
- `apps/web/src/shared/date-format.ts`：甘特日期统一显示为 date-only；
- 提示文字改为“编辑模式 · 修改后自动保存”。

测试：

- API：71 suites / 558 tests passed，1 个既有 skip；
- Web：26 files / 152 tests passed；
- API/Web typecheck passed；lint 0 errors（保留既有 Fast Refresh warning）；
- API/Web build passed（Web 保留既有大 chunk warning）。

当前状态：

- 代码 commit：`51933a5`；
- 备份、正式部署、健康检查与线上验收：进行中；
- 数据库 schema/migration：本任务不需要；
- 未完成：部署一致性、服务健康、权限范围线上核验与最终报告。

Next Recommended Task:
TASK-001 - 创建 `@kdos/ui-schema` 第一版基础 package。

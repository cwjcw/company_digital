# Codex 工作进度

## 任务

任务名称：工序报工待报工视图“剩余数量”可见性修复

任务目标：使 `mps-process-reports` 的 `PENDING` 视图中“累计报工”“剩余数量”与后端资源读取权限一致，并兼容旧个人列布局；不改生产、不迁移、不推送。

当前状态：本地修复与隔离验收完成；未部署、未推送

最后更新时间：2026-11-10

---

## 当前阶段

当前阶段：隔离工作区代码修复与回归

当前子任务：修复共享表格对两个派生字段的二次字段权限过滤，并补个人布局兼容。

## 已完成

- [x] 阅读项目指令、`kdos-form-platform`、`kdos-form-validation` 及现有待报工字段定义。
- [x] 只读确认生产版本：API `22cda3e`、Web `1750f16`；两者存在同一前后端权限判断差异。
- [x] 只读核实王建国用户账号、有效表格权限组、事业部数据范围及个人 PENDING 显示偏好。
- [x] 建立基于生产 Web SHA `1750f16` 的独立 detached worktree；共享工作区 63 项在制改动保持未动。

## 正在进行

- 无。

## 待完成

- [ ] 用户如需生产页面生效，后续另行安排发布；本轮明确不部署。

## 修改文件

- 计划修改：`apps/web/src/shared/KdosDataTable.tsx`
- 计划修改：`apps/web/src/shared/KdosDataTable.spec.tsx`
- 计划修改：`apps/api/src/modules/master-plan-system/master-plan.process-reporting.spec.ts`

## 数据库 Migration

- 无；不修改生产数据或权限。

## 新增或修改测试

- `KdosDataTable.spec.tsx`：普通资源读取员工、旧偏好默认补列、明确隐藏保留、无资源读取权隐藏、仅 PENDING 授权。
- `master-plan.process-reporting.spec.ts`：普通范围读取者无派生字段独立权仍返回两派生列；事业部 ID 仍进入范围 SQL 参数；无资源读取权在查询数据库前拒绝。

## 已运行测试

- Node 24.22.2：Web `KdosDataTable.spec.tsx` 33/33 通过。
- Node 24.22.2：API `master-plan.process-reporting.spec.ts` 15/15 通过。
- Web/API TypeScript 类型检查通过。
- Web共享组件及 API 回归测试 ESLint 通过。
- Web生产构建通过；只有项目已有的 bundle size 提示。
- `git diff --check` 通过。
- 生产版本只读核对：Web `1750f16`、API `22cda3e`，通过读取 `/build-info.json` 与 `/api/v1/health`。
- 生产PostgreSQL只读核实：王建国账号、权限组、事业部范围和个人偏好；仅执行 SELECT。

## 当前已知问题

- 生产当前前后端版本确有字段权限判断不一致；本轮按用户要求未部署，因此线上页面仍待发布。
- 用户要求不自动部署生产、不推送GitHub；本地提交 `a88625b` 保留在独立分支，未推送。
- 仓库主工作区有 63 项其他任务改动，本任务只在隔离 worktree 操作。

## 等待用户确认

- 无。

## 下一步

1. 等待用户后续安排生产发布。
2. 发布前从当前分支构建 Web 候选，使用正式部署流程；无需 API 或 Migration。
3. 用普通员工真实会话验收 PENDING 的剩余数量列和事业部数据范围。

## 恢复执行说明

继续前先读取本文件、检查当前 worktree 状态与 diff；工作目录为 `/tmp/knweb-pending-remaining-20261110`，基线 `1750f162a131a1a0a05166acdd8e242817be2e86`。

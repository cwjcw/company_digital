# Codex 工作进度

## 任务

任务名称：KDOS 通用表格导出选中优先规范。

任务目标：统一实现未选中导出当前视图、已选中仅导出所选记录的 Excel 导出行为，纳入 kdos-form-platform Skill，并补齐权限、跨页、隐藏列和失效记录测试。

当前状态：已完成（本地验证完成；按用户要求未部署、未推送）。

最后更新时间：2026-11-09（Asia/Shanghai）。

---

## 当前阶段

当前阶段：实现、回归验证与交付记录。

当前子任务：已完成共享Skill、前后端导出范围合同及回归测试。

---

## 已完成

- [x] 阅读项目 AGENTS.md、kdos-form-platform Skill、kdos-form-validation Skill及验证级别。
- [x] 检查工作区；识别并保留其他任务的未提交修改与未跟踪截图/报告。
- [x] 确认共享表格已支持跨页选择和按页面可见列生成导出字段，但导出请求忽略了选中记录。
- [x] 确认服务端标准导出目前只按筛选结果取数，尚无显式 selected range 与失效/越权选中拒绝。

## 正在进行

- 无。

## 待完成

- 无。生产部署与GitHub推送按用户要求不执行。

## 修改文件

- `.agents/skills/kdos-form-platform/SKILL.md`
- `apps/web/src/shared/KdosDataTable.tsx`
- `apps/web/src/shared/table-export.ts`
- `apps/web/src/shared/KdosDataTable.spec.tsx`
- `apps/api/src/common/printing/table-export.controller.ts`
- `apps/api/src/common/printing/table-export.controller.spec.ts`
- `apps/api/src/common/printing/table-print.service.ts`
- `apps/api/src/common/printing/table-print.service.spec.ts`
- `outputs/KDOS通用表格导出选中优先进度.md`

## 数据库 Migration

- 无。

## 新增或修改测试

- Web：零选中当前视图、单选、多选跨页、隐藏列、视图切换清除选择。
- API：选中ID精确集合、字段范围、失效或越权拒绝、无效/空ID拒绝，以及原筛选视图导出兼容。
- Controller：显式SELECTED POST契约及拒绝错误范围。

## 已运行测试

- `pnpm --filter @tracker/web exec vitest run src/shared/KdosDataTable.spec.tsx --maxWorkers=2`：通过，31/31。
- `pnpm --filter @tracker/api exec jest --runInBand src/common/printing/table-print.service.spec.ts src/common/printing/table-export.presentation.spec.ts src/common/printing/table-export.controller.spec.ts`：通过，30/30。
- API/Web typecheck：通过。
- API/Web 对应文件 ESLint：通过。
- API/Web production build：通过。
- `git diff --check`：通过。

## 当前已知问题

- 当前运行时 Node v22.23.1，工作区声明要求 Node >=24；本轮相关测试、类型检查、lint与构建均通过，执行环境仍有engine版本提示。
- 按用户要求未做生产部署、浏览器线上验收或GitHub推送。

## 等待用户确认

- 无。

## 下一步

1. 完成共享前端和服务端显式选中范围实现。
2. 添加并运行对应回归测试。
3. 更新 Skill和本进度后交付；遵守本任务不部署、不推送的范围。

## 恢复执行说明

本任务专用恢复入口。恢复时检查相关 Skill、本进度、git status/diff；不得清理或覆盖工作区内属于其他任务的改动。

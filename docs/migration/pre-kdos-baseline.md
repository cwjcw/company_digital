# KDOS 重构前基线

记录时间：2026-08-20 18:32（Asia/Shanghai）

## Git 与工具链

- 当前提交：`98a9cfb1b134360aa9e95ff36121a5eeb295ed5b`
- 当前分支：`dev`
- Node.js：`v22.23.1`
- pnpm：`11.20.0`
- Docker：`29.7.2`
- Docker Compose：`v5.4.0`
- 目标升级版本：Node.js 24 LTS；基线仍为 Node.js 22。

## 重构前未提交修改

重构开始前工作区已有下列修改。本次工作必须保留并在其基础上演进：

```text
M .env.example
M .gitignore
M README.md
M apps/api/src/app.module.ts
M apps/api/src/auth.ts
M apps/api/src/controllers.ts
M apps/api/src/domain.service.spec.ts
M apps/api/src/domain.service.ts
M apps/api/src/entities.ts
M apps/api/src/main.ts
M apps/api/src/modification-audit.ts
M apps/api/src/plan.service.ts
M apps/web/e2e/core.spec.ts
M apps/web/index.html
M apps/web/src/App.tsx
M apps/web/src/app.spec.ts
M apps/web/src/styles.css
M package.json
M pnpm-lock.yaml
?? apps/api/src/auth.guard.spec.ts
?? apps/api/src/data-operations/
?? apps/api/src/migrations/1722920017000-TplusOrderSource.ts
?? apps/api/src/migrations/1722920018000-DailyProcessProgressAndOrderType.ts
?? apps/web/public/
?? data-operations/
?? docs/开发/
```

重构前 tracked diff 统计：19 个文件，1010 行新增、112 行删除。完整补丁和未跟踪文件清单已保存到仓库外备份目录。

## 源码与数据库备份

- 仓库外源码归档：`/data/automation/code/work/PMC/knweb-pre-kdos-backup-20260820/knweb-source-pre-kdos.tar.gz`
- 源码归档 SHA256：`28fa34fa671a130acae4deae6a40214939b266ae17456603e8cf6c2a9a1972fa`
- tracked 工作区补丁：`/data/automation/code/work/PMC/knweb-pre-kdos-backup-20260820/pre-kdos-worktree.patch`
- 补丁 SHA256：`458ab7c62203ba679a94cd8799803b21f6d22aa9bf489a4a8d13fe5d218c3111`
- 未跟踪文件清单：`/data/automation/code/work/PMC/knweb-pre-kdos-backup-20260820/untracked-files.txt`
- 旧数据库备份：`data/backups/four_department_tracker_20260820_183141.backup`
- 旧数据库备份 SHA256：`8ea9182f00d61e1ce148db6b261c83db4cdc58725668f274221ebe09681f7ba3`
- 上传目录备份：`data/backups/uploads_20260820_183141.tar.gz`
- 上传目录备份 SHA256：`b8231687f222a2d8dfd9b9a749a024d6b0054bd68a186f278d18c9def00a6c42`

源码归档排除了 `.git`、`node_modules`、`dist`、`build`、实际 `.env`、数据库持久化目录、上传目录、备份和日志；保留了源码、脚本、文档、锁文件、Compose、迁移和所有未提交工作区文件。

## 重构前目录结构

```text
apps/
  api/              NestJS + TypeORM API
  web/              React + Vite 前端
packages/
  shared/           97 列、14 工序、字典与权限共享契约
data-operations/
  tplus/            T+ 双账套读取与同步脚本
scripts/            开发、部署、迁移、备份、恢复与健康检查
docs/               架构、业务规则、模板和开发任务书
outputs/            生成物
compose.yaml
package.json
pnpm-workspace.yaml
```

## 重构前数据库方式

- 数据库：PostgreSQL 18，库名 `four_department_tracker`。
- ORM：TypeORM 0.3，显式 migration，未使用生产 `synchronize=true`。
- 运行方式：Docker Compose 的 `postgres`、`api`、`web` 三服务。
- 持久化：宿主机 `data/postgres` 和 `data/uploads`。
- 旧数据库在 KDOS 验收前保留，不做删除或覆盖。
- 基线时三个容器均为 healthy，`/api/v1/health` 返回成功。

## 重构前主要功能

- 销售接单汇总大屏和销售接单明细。
- 月度计划 97 列 AG Grid、双层/多层表头、横向虚拟滚动、编辑、筛选、字段显示、图片和 Excel 导入导出。
- 14 个配置化工序、外协、日进度、欠数/金额/完成率/状态计算。
- 月初滚动、乐观锁、Socket.IO、审计日志。
- 用户、角色、资源/字段权限、事业部和组织范围、API Key。
- 供应商、字典、工序、成品入库、通讯录。
- T+ 双账套销售订单同步。
- Docker 部署、健康检查、备份、恢复和迁移。

## 重构前主要页面

- 销售接单汇总大屏
- 销售接单明细
- 月度计划（202608 至 202612）
- 日进度
- 基础资料维护
- 成品入库
- 审计日志
- 用户与角色
- API Key 管理
- 通讯录

## UI 基线截图

- [主计划重构前截图](screenshots/master-plan-before.png)
- [月度计划重构前截图](screenshots/monthly-plan-before.png)

截图使用 Playwright 的 mock 业务数据生成，分辨率为 1280 × 900，目的是固定布局、主要字段、菜单和交互基线，不代表生产数据。

## 输入文档说明

`docs/开发/` 中实际只有 `Codex 总任务书：KDOS 第一阶段 + Planning Center 主计划编排.md` 包含内容（3216 行）；`工作台.md` 在重构开始时为空文件。

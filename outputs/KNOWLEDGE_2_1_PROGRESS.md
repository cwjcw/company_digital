# Codex 工作进度

## 任务
任务名称：Knowledge 2.1 文件型知识架构与在线预览。
任务目标：完成Phase A/B、测试、备份migration部署与真实管理员验收。
当前状态：已完成。
最后更新时间：2026-10-09 18:34（Asia/Shanghai）。
最终报告：outputs/KNOWLEDGE_2_1_ACCEPTANCE.md。

## 当前阶段
当前阶段：已部署并验收。
当前子任务：无。

## 已完成
- [x] 按初始本地/远程ba91c5d审查现有代码，不回退；保留先前导入输出。
- [x] 统一FILE/RICH_TEXT资产、PRIMARY/INLINE/SUPPLEMENTAL工作/发布关系及不可变快照；新migration。
- [x] 磁盘100MB有界上传/统一加密/格式和ZIP校验，ObjectStorage stat/stream/Range，全部读取复用ACL。
- [x] 持久Job/SKIP LOCKED/租约/幂等/失败保留原件/管理员重试；独立非root无外网Worker与六种实际转换。
- [x] 新建两入口、20文件逐项进度/部分成功、PDF.js分页缩放全屏、主文件替换、说明标签位置/图片拖放和autosave。
- [x] 备份/迁移/应用部署/SHA/健康检查，PostgreSQL容器与挂载保留。
- [x] 真实管理员18项PASS、自有数据清理；员工线上未授权、不改账号权限。

## 正在进行
- 无。

## 待完成
- 无授权范围内遗留。

## 修改文件
- apps/api/Dockerfile
- apps/api/package.json
- apps/api/src/migrations/1722920086000-Knowledge21FilePages.ts
- apps/api/src/modules/knowledge/knowledge.application.service.ts
- apps/api/src/modules/knowledge/knowledge.controller.spec.ts
- apps/api/src/modules/knowledge/knowledge.controller.ts
- apps/api/src/modules/knowledge/knowledge.database-validation.ts
- apps/api/src/modules/knowledge/knowledge.export.service.ts
- apps/api/src/modules/knowledge/knowledge.files.database-validation.ts
- apps/api/src/modules/knowledge/knowledge.files.service.ts
- apps/api/src/modules/knowledge/knowledge.filter-sources.ts
- apps/api/src/modules/knowledge/knowledge.module.ts
- apps/api/src/modules/knowledge/knowledge.preview.service.ts
- apps/api/src/modules/knowledge/knowledge.query.service.ts
- apps/api/src/modules/knowledge/knowledge.range.spec.ts
- apps/api/src/modules/knowledge/knowledge.range.ts
- apps/api/src/modules/knowledge/knowledge.types.ts
- apps/api/src/modules/knowledge/knowledge.upload.spec.ts
- apps/api/src/modules/knowledge/knowledge.upload.ts
- apps/api/src/modules/knowledge/knowledge.worker.spec.ts
- apps/api/src/modules/knowledge/knowledge.worker.ts
- apps/api/src/storage/local-object-storage.spec.ts
- apps/api/src/storage/local-object-storage.ts
- apps/api/src/storage/object-storage.ts
- apps/web/e2e/knowledge-ui.spec.ts
- apps/web/nginx.conf
- apps/web/package.json
- apps/web/src/modules/knowledge/KnowledgeContent.spec.tsx
- apps/web/src/modules/knowledge/KnowledgeContent.tsx
- apps/web/src/modules/knowledge/KnowledgeEditor.tsx
- apps/web/src/modules/knowledge/KnowledgeFilePreview.spec.tsx
- apps/web/src/modules/knowledge/KnowledgeFilePreview.tsx
- apps/web/src/modules/knowledge/KnowledgeFileUpload.spec.tsx
- apps/web/src/modules/knowledge/KnowledgeFileUpload.tsx
- apps/web/src/modules/knowledge/KnowledgePageSelect.tsx
- apps/web/src/modules/knowledge/KnowledgePages.spec.tsx
- apps/web/src/modules/knowledge/KnowledgePages.tsx
- apps/web/src/modules/knowledge/knowledge-file-upload.spec.ts
- apps/web/src/modules/knowledge/knowledge-file-upload.ts
- apps/web/src/modules/knowledge/knowledge-ui.ts
- apps/web/src/modules/knowledge/knowledge.css
- compose.yaml
- docs/runbook.md
- packages/contracts/src/index.ts
- packages/contracts/src/knowledge.ts
- pnpm-lock.yaml
- scripts/deploy.sh
- scripts/healthcheck.sh
- scripts/migrate.sh
- scripts/validate-knowledge.mjs

- outputs/KNOWLEDGE_2_1_PROGRESS.md、CODEX_PROGRESS.md、ACCEPTANCE.md、PHASE_A/B.md、DATABASE_VALIDATION.json、ADMIN_ACCEPTANCE.json、DEPLOYMENT.json；初轮失败记录保留复盘。

## 数据库 Migration
- 新1722920086000-Knowledge21FilePages.ts已经生产COMMIT；旧migration未改。
- 13张Knowledge表标准审计/RLS通过；来源文件/已发布关系原样保留。下行恢复须验证过的完整备份。

## 新增或修改测试
- 磁盘上传、格式/加密/ZIP bomb、Range/HEAD/HTTP权限、流式存储、超时/崩溃、真实FILE模型/版本/租约/幂等/RLS、批量部分失败/传输/预览/缺省versionId、原Knowledge回归。

## 已运行测试
- API93suites811PASS，1原有SKIP；其他workspace43PASS。
- Web35文件248PASS，Knowledge前端6文件36PASS；后端专项9suites90PASS。
- 隔离DB76场景PASS，85migration新安装重放PASS。
- Office六种现代/旧格式转换PASS，非root uid1001/network none；合法legacy上传校验PASS。
- Chrome fixture3PASS/1条件SKIP；真实生产管理员18PASS，未保存敏感凭据/录制。
- Workspace类型/lint/build和最终专项类型lint通过；原Portal1warning/chunk大小warning保留。
- 最后scripts/deploy.sh all/check、scripts/healthcheck.sh PASS；Worker停机不影响API并恢复healthy。

## 部署/备份/修正记录
- 最终HEAD/Web/API/Worker `2c68cc51e5e2890823a16a8cc30d79ea497d9a5a` 一致，未push远程。
- 备份180526及migration前180946均保留legacy/KDOS/uploads及SHA，pg_restore/tar/SHA验证通过，hash见最终报告。
- PostgreSQL原容器ID/挂载未变化；APIpostgres:5432与回环15433不变。Worker内部网络、无代理运行环境、外部TCP阻断通过。
- 修正UPDATE返回元组；Compose无依赖创建方式/服务别名；真实.mjs MIME及undefined versionId；两项缩放/历史selector仅验收脚本修正。修复后全量/实际验收通过，失败记录保留。

## 当前已知问题
- 无授权范围阻塞。员工真实账号未授权，自动ACL/RLS通过；Office复杂排版/Excel打印区域、文件内部全文提取/OCR/RAG限制见报告。

## 等待用户确认
- 无。

## 下一步
1. 无需继续实现或再次migration，用户可打开线上知识库使用。
2. 若后续明确授权员工验收，使用已有实际账号，不修改权限或密码。

## 恢复执行说明
项目规范→本进度→Git状态/diff。任务已完成，保留报告和旧任务输出；不得重新导入10091/10092或重复创建Knowledge文件架构。当前未提交内容仅outputs报告，源码已提交并上线。

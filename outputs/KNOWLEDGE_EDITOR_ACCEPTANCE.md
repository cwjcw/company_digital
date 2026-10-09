# Knowledge 2.1 编辑页面验收

结果：**PASS，已部署并完成真实界面验证**。时间：2026-10-09 20:44（Asia/Shanghai）。

基线：只读核对 GitHub remote `github` 的 HEAD/main，均为 `3ee7190d792e015a0860d8fa1557403ce8ae087d`，与修改前本地 HEAD 一致；修改前源码工作区干净。源码提交 `c8e38aa10ed84cc0283c7a2e8fe2458633128ba0`，未 push。

## 本次修改

| 文件 | 修改内容 |
|---|---|
| `apps/web/src/modules/knowledge/KnowledgeEditor.tsx` | 移除页面标签 Select 与对应 import；授权 breadcrumb 排除当前页面后显示为 Space > 祖先/父页面，放在标题上方；主文件/在线预览或富文本正文置于简要说明之前。 |
| `apps/web/src/modules/knowledge/knowledge.css` | 路径使用紧凑灰色文字，长路径可换行。 |
| `apps/web/src/modules/knowledge/KnowledgePages.spec.tsx` | 新增5项路径、无标签/位置控件、正文/文件布局、说明保存→主文件上传→发布版本衔接回归；验证增量 PATCH 不包含 tags。 |
| `apps/web/e2e/knowledge-ui.spec.ts` | 实际 Chrome fixture 检查标签控件消失、路径位于标题上方及 V1/V2 已有 Tags 保留。 |

记录文件：`outputs/CODEX_PROGRESS.md`、本报告、`KNOWLEDGE_EDITOR_ADMIN_ACCEPTANCE.json`、`KNOWLEDGE_EDITOR_ADMIN_FIRST_ATTEMPT.json`、`KNOWLEDGE_EDITOR_LIVE.json`。运行时管理员验收脚本置于 `/tmp`，凭据通过关闭 echo 的运行时 stdin 消费；无凭据/token/截图/trace/video/storageState 持久化。

数据库 migration：无。新增 npm 依赖：无。新增/修改 API：无。权限、租户、搜索和版本模型沿用现有实现。

## Tags 与保存安全

仅删除标签编辑控件。数据库 Tags、API tags 字段、标签搜索和发布快照均保留，原有标签没有删除。页面保存仍由现有 KnowledgeDraftSession 增量 PATCH；改标题/说明/正文不会提交空 tags 或整个页面对象。上传与发布继续经同一串行会话先 flush，再使用返回的 expectedVersion，所有保存、上传、发布、409 处理代码保持原样。

真实管理员验收在自建富文本/文件页面通过 API 设置已有 Tags，再经新版 UI 自动保存、上传/替换和发布；当前版本及 V1 标签、标题/正文、旧主文件保持正确，标签关键词仍命中两类页面。实际并发更新触发409后，本地文字保留、发布禁用、服务器内容没有被覆盖。只操作并清理标记的自建验收子树，未修改账号密码或权限。

## 自动化与实际界面

| 验证 | 结果 |
|---|---|
| Knowledge 前端专项 | 6文件、41项 PASS |
| 完整 Web 回归 | 35文件、253项 PASS |
| Chrome fixture E2E | 3 PASS；1运行时凭据门控用例 skip，真实管理员独立验收见下一行 |
| 生产管理员实际 Chrome | 9项 PASS：登录/权限、两种编辑布局、真实Autosave、DOCX上传/PDF.js有内容画布、说明保存、替换主文件/V2/V1历史、Tags搜索、实际409、清理自建树 |
| Web lint / typecheck | PASS，lint 0 error |
| 本地 Web build | PASS |
| Docker Node24 Web生产构建 | PASS |
| 升级后健康检查 | Web/API/PostgreSQL/document-worker、Swagger/OpenAPI PASS |

已有提示保留：宿主 Node22 与项目要求 Node24 的 engine 提示、Portal react-refresh lint warning、Vite大chunk提示；生产镜像使用Node24。首轮线上脚本把富文本“插入私有图片”下拉误判成位置控件，收窄检查后重跑9项全通过；该首轮自建页面也已清理，产品没有因此增加兼容代码。实际员工账号验收沿用用户“仅验收管理员”的范围，没有更改任何员工权限。

测试命令：

```bash
pnpm --filter @tracker/web test src/modules/knowledge --maxWorkers=2 --testTimeout=15000
pnpm --filter @tracker/web test --maxWorkers=2 --testTimeout=15000
pnpm --filter @tracker/web lint
pnpm --filter @tracker/web typecheck
pnpm --filter @tracker/web build
E2E_BASE_URL=http://127.0.0.1:15175 pnpm --filter @tracker/web test:e2e e2e/knowledge-ui.spec.ts --workers=1
```

## 备份与上线

部署前运行 `./scripts/backup.sh`，三份备份的数据库目录可读性及 SHA256 均通过；uploads 包含 `.private`，归档目录可读取。

| 备份（均位于 data/backups） | SHA256 |
|---|---|
| `four_department_tracker_20261009_203617.backup` | `4dec46989a510ada4d35e842146252dfb5eda57a5177a8012c63917a184f88ea` |
| `kdos_20261009_203617.backup` | `e0204409652b30643ca32ae1aa21ed79acab818ef92ba369c27eb08651411751` |
| `uploads_20261009_203617.tar.gz` | `8831284d3a65abeee382610420b456bba0f1d702fb596e1b93f972ed3f3e685b` |

实际执行 `./scripts/deploy.sh web`，只更新 Web，脚本核对 Repository HEAD 与 Web Build 都为 `c8e38aa`，输出 `STATUS: CONSISTENT`。API 与 document-worker 保持原 `2c68cc5` 版本；这是本次 Web 单独部署的预期结果。升级后两次 `./scripts/healthcheck.sh` 均通过，四服务 healthy，原 PostgreSQL 容器ID、挂载、回环15433端口均保持，API继续使用 `postgres:5432`。没有数据库迁移。

线上地址：<http://192.168.1.249:15172/knowledge>。自建验收数据已清理，无本轮遗留故障。

## 人工验收

1. 登录后进入知识库，编辑一个已有页面：确认标题上方显示Space及父页面路径，页面标题下方没有标签输入，也没有位置选择器。
2. 编辑在线文章：正文优先展示，修改标题/正文后等待“已保存”；发布后再次编辑和发布，确认版本正常增加。
3. 编辑文件页面：确认主文件上传/替换和在线预览优先，简要说明在其后；修改说明、替换主文件并发布，历史版本仍可预览原文件。
4. 用已有标签搜索页面，确认仍可命中。需要验证并发时，用同一自建页面的两个编辑窗口制造旧版本提交，确认409提示、本地文字保留及发布禁用。不要用正式页面做并发测试。

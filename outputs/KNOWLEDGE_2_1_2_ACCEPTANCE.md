# Knowledge 2.1.2 Acceptance

状态：开发、自动化测试、备份、部署、健康与管理员真实验收 PASS；普通员工登录/未授权拒绝 PASS，获权阅读验收受当前账号页面查看权限限制。
最终更新时间：2026-10-09 22:57（Asia/Shanghai）。

## 基线及范围

GitHub main与本地基线均为201956554bac8834ce397dbab79bbc7569a70ee4；上线前Web/API为88f48cbdc7536b76686c9342a5a3abde3fe72eba（后续2019565仅更新验收资料）。遵守AGENTS、ARCHITECTURE、SECURITY、runbook及kdos-form-platform规范。源码提交e16c2f74de1013fdedcec8f69d8b2863ef0d4551；未push。

本轮只修改Knowledge模块与测试/验收记录，不开发2.2、不改其他业务模块。无数据库迁移、依赖或新增API；沿用已有上传接口的title参数，不变更接口契约。

## 确认缺陷与修复

| 原问题 | 实际修复 |
| --- | --- |
| 上传只提供原文件名，无法逐个填写title | 去扩展名默认标题；逐文件知识页面标题输入，300字符限制及非空校验；FormData提交title |
| 批量没有移除、完成提醒和完整结果 | 未提交项可移除；执行中禁用修改/移除；展示成功/失败/未完成数量；失败或未上传项离开确认；全部成功页面结果列表可再次打开 |
| 失败复用键但重新读取当前保存位置，响应丢失可能造成冲突 | 第一次真实提交固定File/title/spaceId/parentId/key；请求快照只读；未知结果只允许原请求重试；明确拒绝后显式重新发起才产生新键；后续403也不能解除原未知结果；同步ref阻止重复点击 |
| 位置说明在在线编写/导入/移动中仍说上传文件 | 同一位置选择器按四种操作显示准确说明，保留完整路径、搜索、分页/懒加载和授权/循环检查 |
| DOCX导入预览静默过滤内嵌图片 | 原位置渲染明确占位，说明正式导入后可查看；不请求临时图片或外部URL；正式导入服务不变 |
| 无权限员工可见空间设置/归档入口 | 结合现有资源/字段权限及服务端canManage显示；保留回收站、创建、编辑、ACL的现有后台授权 |

已实现而未重复改动：FilesService标题默认与非空/300字符校验，租户+操作者幂等记录与内容哈希；编辑改名/Autosave/409；原文件和发布版本不可变；Page Tree与ACL继承；保存位置分页/循环授权；Tags数据库/API/搜索/历史能力。没有重新添加标签控件。

## 修改文件

- apps/web/src/modules/knowledge/KnowledgeFileUpload.tsx
- apps/web/src/modules/knowledge/knowledge-file-upload.ts
- apps/web/src/modules/knowledge/KnowledgePages.tsx
- apps/web/src/modules/knowledge/KnowledgeLocationPicker.tsx
- apps/web/src/modules/knowledge/KnowledgeImport.tsx
- apps/web/src/modules/knowledge/KnowledgeContent.tsx
- apps/web/src/modules/knowledge/KnowledgeFileUpload.spec.tsx
- apps/web/src/modules/knowledge/knowledge-file-upload.spec.ts
- apps/web/src/modules/knowledge/KnowledgePages.spec.tsx
- apps/web/src/modules/knowledge/KnowledgeLocationPicker.spec.tsx
- apps/web/src/modules/knowledge/KnowledgeImport.spec.tsx
- apps/web/e2e/knowledge-ui.spec.ts
- apps/api/src/modules/knowledge/knowledge.files-title.spec.ts（新增）
- apps/api/src/modules/knowledge/knowledge.files.database-validation.ts
- outputs/CODEX_PROGRESS.md及本轮验收报告/证据JSON。

## 自动化结果

| 验证 | 结果 |
| --- | --- |
| API全量Jest | 95套、826项PASS；1原有skip；Knowledge新增8项，共97项通过 |
| Web全量Vitest | 38文件、277项PASS；Knowledge9文件65项PASS |
| 真实隔离PostgreSQL回归 | 85场景PASS，85个既有迁移fresh验证PASS；临时数据库/角色清理 |
| Chrome UI fixture | 3 PASS，1运行时凭据门控skip；生产账号采用独立运行时无录制脚本 |
| 根typecheck、lint、build | PASS；原有Portal fast-refresh、Vite大chunk、宿主Node22与ts-jest提示未引入新警告 |
| git diff --check | PASS |

新增自动化重点：标题默认/中文/最大长度/非法值、提交前移除、批量不同标题/部分失败/离开确认/全部结果、同键重试/明确新请求/未知结果安全、服务器提交后响应丢失、防双击、V1/V2后改名/原件/存储路径不变、树与详情标题、四种位置说明、图片占位及无外部图片请求、员工入口隐藏。已有Autosave/409、原件/预览、ACL/RLS、懒加载/100+分页/同名路径/循环/Tags回归继续通过。

早期测试运行发现测试脚本定位问题（Ant Modal标题重复/按钮动画）及fixture缺少extension；已修正测试，不增加产品兼容代码；最终全量通过。

## 部署与真实验收

- 备份时间戳：20261009_224154。`scripts/backup.sh`备份four_department_tracker、kdos及uploads；两库pg_restore --list、上传归档可读取/包含.private、三份SHA256复核均PASS。备份文件位于data/backups，具体校验和见KNOWLEDGE_2_1_2_LIVE.json。
- 实际部署命令：`./scripts/deploy.sh all`；最终`./scripts/healthcheck.sh`及`./scripts/deploy.sh check`通过。
- 部署完整SHA：`e16c2f74de1013fdedcec8f69d8b2863ef0d4551`；Repository HEAD/Web/API完全一致。Docker使用Node24构建成功。
- Web、API、document-worker、PostgreSQL均healthy；未重建PostgreSQL，部署前后容器ID、数据挂载和127.0.0.1:15433映射完全一致；API仍连接postgres:5432。无新增migration，无生产业务数据迁移。
- 浏览器：真实Chrome，通过192.168.1.249:15172登录并操作线上环境；共13组PASS（管理员9组、员工3组、清理1组），详见KNOWLEDGE_2_1_2_BROWSER_ACCEPTANCE.json。未保存凭据、token、trace、video、截图或浏览器登录状态。
- 管理员实际验收：默认/自定义中文/批量标题；上传前移除；3成功/1失败及成功草稿保留；同键失败重试、明确新请求的新键；离开确认、全部草稿及重新打开结果；DOCX/PPT/PDF真实画布和原件；真实服务已提交后在响应交付阶段模拟超时，变更全局位置并双击重试仍参数一致/repeated=true/仅1页面；草稿与V1/V2后改名/树标题/原件及历史不变；真实含图片DOCX的预览占位及正式私有图片；四种位置说明；真实409保留本地数据并禁止发布。
- 员工实际验收：E2E登录/权限验证通过；知识空间GET200，但知识页面GET403；界面呈现无页面查看权限提示，未呈现管理操作；发布页/历史/原件/草稿及伪造新增请求均被拒绝。该账号目前没有knowledge-pages读取权限，不能据此声称员工获权阅读/具体Page私密ACL的生产验收通过。没有修改账号密码/权限，已向用户说明该限制。
- 清理：每轮仅创建带专用前缀的验收根页面及子树；全部自建页面、历史版本和附件通过既有Application API永久清理，保留必要审计；未新增或修改现有Space。隔离测试库/角色已清理。早期脚本失败轮也已清理自身子树，说明保存在FIRST/SECOND/THIRD/FOURTH_ATTEMPT.json。
- 早期真实验收脚本的问题为缺少员工页面查看权限、Modal隐藏标题定位、Chromium multipart postData为空、编辑器返回按钮标签不匹配；修正验收脚本后完成最终验收，没有为这些脚本问题加入产品兼容代码。

## 未测试项目及原因

1. 生产员工获权阅读发布V2、历史V1及具体私密页面/附件隔离：账号现有知识页面读取权限不足（403）。仅确认登录和未授权拒绝，不更改账号授权；对应正向阅读、ACL/RLS及按钮隐藏由自动化/隔离数据库/Chrome fixture覆盖。用户自行补齐既有页面查看权限后可继续实际验收。
2. 生产空间100+页面、同名路径及移动循环的大规模再造：未批量污染生产；已有105页面/分页/多层同名/循环/授权隔离数据库和前端测试PASS。移动位置说明已实测，原移动与文件V1/V2替换流程沿用既有验收和本轮自动化回归。
3. 本轮未在线逐一重跑DOC/XLS/PPT旧格式、Excel/图片原件等所有组合：未修改解析器、存储或转换服务；既有相关API/Web/DB回归通过，生产重点重跑DOCX/PPTX/PDF原件与预览。
4. 图片预览选择明确占位方案，不提供导入前临时图片像素预览；正式导入后私有图片已实测。
5. Knowledge2.2、文件存储架构变更、其他业务模块均不在范围；没有对应开发遗留。

## 人工验收步骤

1. 在知识空间/公司制度页面点新建知识→上传文件，确认完整保存路径及上传说明。
2. 选择多个文件，检查去扩展名默认标题，分别修改中文标题；移除其中一项再上传。
3. 混入无效PDF，检查成功/失败数量；完成时选择继续重试或确认离开，确认成功草稿保留及全部结果可查看。
4. 网络中断后恢复再重试；已提交标题固定，未知结果不得重新发起；只生成一个草稿。
5. 打开文件编辑页改名/发布V1/V2/再改工作标题，确认树同步、原文件名和历史版保持原状。
6. 用含图片DOCX从文档导入，检查预览占位，正式导入后图片可见；在线编写/导入/移动的保存位置说明分别正确。
7. 普通员工阅读发布知识和历史原件，确认管理按钮隐藏且无权页面/文件不可访问。

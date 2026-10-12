# Knowledge 2.2 UI Refresh 验收报告

状态：已完成 / PASS，已备份并部署，真实管理员线上验收通过。

验收时间：2026-10-10T09:19:02+08:00

## 范围及实现

从本地最新HEAD 29f328e继续，产品源码与上一轮交付3e5fea0一致。只修改Knowledge页面布局，不调整业务、权限、数据库、文件存储或其他模块布局。

| 页面 | 最大宽度 | 布局 |
| --- | ---: | --- |
| 首页/搜索结果 | 1180px | 居中 |
| 空间浏览 | 1280px | 240px目录 + 自适应内容，窄屏上下排列 |
| 在线文章 | 900px | 居中阅读，保留目录 |
| Word/PDF/PPT等文件 | 1180px | 居中，保留预览工具栏、原件下载 |
| 管理后台 | 1320px | 居中，保留现有侧栏和编辑器 |

页面容器使用100%可用宽度及margin-inline:auto；桌面左右留白自然分配。手机内容外边距clamp(12px,4vw,16px)，卡片单列；首页卡片与段落间距适度收紧。1440/1920px不再无限拉伸。加载/错误的空间页面同样应用空间宽度。

## 修改文件

- apps/web/src/modules/knowledge/KnowledgePortal.tsx：首页、空间和阅读类型增加布局类。
- apps/web/src/modules/knowledge/knowledge.css：五类宽度上限、目录240px、居中与手机边距；样式限定Knowledge。
- apps/web/e2e/knowledge-ui.spec.ts：新增六个视口真实Chrome布局测试，检查五类页面宽度、居中、无横向溢出、目录宽度及退出模块恢复原布局。
- outputs/KNOWLEDGE_2_2_PROGRESS.md：本任务唯一恢复入口。
- outputs/CODEX_PROGRESS.md：恢复指针。
- outputs/KNOWLEDGE_2_2_UI_REFRESH_ACCEPTANCE.md及浏览器JSON：本轮交付证据。

API/数据库Migration/依赖：均无。源代码提交：eeca5fb3f7c12946dcb47323280f346b9e3f60bc。

## 自动化验证

- Knowledge Web专项：11文件/99项PASS。
- Chrome：13项PASS/1运行时凭据门控SKIP；新增6视口（1920/1440/1280/768/390/320）各检查5类页面，全部PASS。
- Web typecheck/lint/build PASS；lint仅既有ModulePortal Fast Refresh warning，构建仅既有大chunk提醒。宿主Node22有项目要求Node>=24的既有提醒，生产镜像使用Node24。
- 完整Web回归：40文件/311项全部PASS，224.64秒。
- API与数据库源码未变，本轮不重复执行API全量或隔离数据库测试，前轮结果参见KNOWLEDGE_2_2_ACCEPTANCE.md。

## 备份、部署与线上验收

备份20261010_091156：four_department_tracker、kdos、uploads；双库pg_restore目录验证PASS，归档及数据库文件权限600。

SHA256：
- four_department_tracker：48745e24a8065de44be56ff826fbe225ee2bb6c738fbe53d73745cd3a834b03a
- kdos：98227fd788ff08ae79a8926545dd26d4271fe37bbc448630a190519bf1e8994a
- uploads：e74791289a27cbfad5f893a25492ebb574c6cab060ca432e4be4851b47265fb4

部署命令：./scripts/deploy.sh all，PASS。HEAD/Web/API/Document Worker均eeca5fb3f7c12946dcb47323280f346b9e3f60bc。./scripts/healthcheck.sh与./scripts/deploy.sh check PASS，Web/API/Worker/PostgreSQL healthy。

PostgreSQL原容器b679ba44dd75、原data/postgres挂载及127.0.0.1:15433映射保持原样；API仍通过postgres:5432连接。

真实管理员浏览器12项PASS，包含30组页面/视口测量、三类文档实际预览与下载、工作台原布局恢复及测试数据清理。文件预览通过真实Worker/PDF.js加载并验证非空像素。仅清理自建测试子树、版本和文件，必要审计保留，既有空间未修改。证据：[KNOWLEDGE_2_2_UI_REFRESH_BROWSER.json](KNOWLEDGE_2_2_UI_REFRESH_BROWSER.json)。不保存凭据、浏览器存储、录像或截图。

| 视口 | 首页 | 空间 | 文章 | 文件 | 管理 | 左右边距 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1920 | 1180 | 1280 | 900 | 1180 | 1320 | 各页面居中，左右自动分配 |
| 1440 | 1180 | 1280 | 900 | 1180 | 1320 | 各页面居中，左右自动分配 |
| 1280 | 1180 | 1203.22 | 900 | 1180 | 1203.22 | 随可用空间自适应 |
| 768 | 721.94 | 721.94 | 721.94 | 721.94 | 721.94 | 约23.03px，目录上下排列 |
| 390 | 358.81 | 358.81 | 358.81 | 358.81 | 358.81 | 约15.59px |
| 320 | 294.41 | 294.41 | 294.41 | 294.41 | 294.41 | 约12.80px |

全部无页面横向溢出；桌面空间目录240px，桌面文件预览可用宽度1098px。

当前没有未完成开发或部署项；既有工具链提醒已列出，不影响本轮通过结果。

## 未测试项目

本轮布局任务不重复执行生产员工账号的正向阅读验收；普通用户隔离在Chrome自动化中覆盖。不会修改账号权限或把管理员验收表述为员工生产验收。

## 人工验收

1. 打开/knowledge，在1440或1920屏幕检查首页居中和自然留白。
2. 进入知识空间，检查240px目录及内容区；缩小窗口后目录上下排列。
3. 阅读在线文章，检查900px上限；阅读Word/PDF/PPT文件，检查1180px上限、预览和原件下载。
4. 进入/knowledge/manage，检查1320px上限；长文档编辑时保存/发布栏仍可操作。
5. 在390px或320px手机视口检查12–16px安全边距，无页面横向溢出；返回工作台检查其他模块原布局。

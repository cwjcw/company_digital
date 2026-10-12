# Knowledge Permission UI Acceptance

状态：已完成 / 本次入口优化验证通过并上线。
日期：2026-10-12（Asia/Shanghai）。

## 原问题与修复

空间管理页手工放置了knowledge-spaces与knowledge-pages两个同名权限按钮，公共KdosDataTable还自动添加一个权限按钮，实际存在重复和跨资源入口混淆。

- 空间管理移除两个手工按钮，复用公共表格自动入口，名称为「空间操作权限」，目标仍为 `/permissions/knowledge-spaces`。
- 页面与文件工作台顶部增加「页面与文件操作权限」，目标为 `/permissions/knowledge-pages`；仅在页面与文件及其页面详情管理路径显示，不放入空间/归档/回收站页。
- 空间行「成员」改为「成员与权限」，继续GET原空间access接口并打开原KnowledgeAccess。
- TablePermissionButton新增可选label，默认仍为「权限管理」。KdosDataTable新增可选permissionButtonLabel，只传给自动权限按钮，避免显式再加一个造成重复；其他模块默认文案/资源/返回链接不变。

## 权限与接口范围

平台按钮继续使用原canManageTablePermissions；KnowledgeAccess继续使用原Space.canManage、表操作及access字段读写资格，不把Space FULL_ACCESS提升为系统或模块管理员。

后端requireTableAdministrator仍独立检查系统管理员或资源所属模块管理员；没有修改API、DTO、数据库、ACL模型、权限组、账号权限或授权规则。无migration，无新增npm依赖。

人员、组织、角色、全公司四类对象及只读、编辑、完全管理三级授权继续来自原KnowledgeAccess与契约。真实验收只打开/选择本地未保存项后取消，未PATCH权限、未新增权限组或成员授权；登录和logout按既有认证流程执行。

## 修改文件（4）

1. apps/web/src/shared/KdosDataTable.tsx：可选label及自动按钮caption参数，权限检查不变。
2. apps/web/src/modules/knowledge/KnowledgeSettings.tsx：移除重复入口、空间操作权限文案、成员与权限文案。
3. apps/web/src/modules/knowledge/KnowledgePages.tsx：页面与文件顶部专用入口，复用原平台管理员判定。
4. apps/web/src/modules/knowledge/KnowledgePermissionUi.spec.tsx：12项专项回归，实际公共表格参与测试以捕捉重复入口。

报告及outputs/CODEX_PROGRESS.md为交付记录，不包含凭据。

## 自动化结果

- 新增12项：系统管理员、Knowledge模块管理员、FULL_ACCESS空间负责人、普通员工、其他模块管理员兼空间负责人，分别验证两个管理页入口；原Access四对象三级控件；其他模块默认按钮与原目标不变。
- 空间负责人在拥有既有表/字段维护权限时能看到「成员与权限」，即使FULL_ACCESS仍不出现平台操作权限入口。普通员工无维护权限时不显示成员管理；其他模块管理员不能管理Knowledge平台权限。
- Web全量44文件339项通过，包含原Settings/Pages及共享表格、审计身份、Autosave/发布等回归。
- 相关API权限组、管理员应用、Knowledge scope/controller回归4套29项通过，后台代码未改。
- Web typecheck、lint、production build通过。原Portal Fast Refresh、chunk-size和PDF Node提示保留，0正式错误。
- 开发期新增测试遇到Ant Select wrapper/input同名aria-label、已选值和候选同名title，改为精确combobox及候选元素定位后全部通过；没有为此修改生产控件或权限逻辑。

证据：KNOWLEDGE_PERMISSION_UI_TARGETED_FIX.log、KNOWLEDGE_PERMISSION_UI_WEB_FULL.log、KNOWLEDGE_PERMISSION_UI_API_REGRESSION.log、KNOWLEDGE_PERMISSION_UI_TYPECHECK.log、KNOWLEDGE_PERMISSION_UI_LINT.log、KNOWLEDGE_PERMISSION_UI_BUILD.log。

## 备份与部署

- 开始HEAD：e498473a1930b7683262982577225d0f8d451bdc。
- 提交/结束HEAD：ca0d7d7d9ab99aaf0eadf076aed443525826c482；`fix(knowledge): distinguish space and page permission entries`，未push。
- 备份：20261012_125217的legacy与KDOS custom dumps、uploads归档含.private；pg_restore目录可读，三个SHA256再次复核通过。见KNOWLEDGE_PERMISSION_UI_BACKUP.json。
- 本轮仅前端改动，按docs/runbook.md正式执行 `./scripts/deploy.sh web`，返回0，Repository HEAD=Web SHA=ca0d7d7，STATUS=CONSISTENT（Web部署范围）。API/Worker未重建，继续e498473；这是明确的前端部署，不声称四个SHA都升级为新HEAD。
- healthcheck.sh通过，Web/API/Worker/PostgreSQL均healthy，Dispatcher active。原PostgreSQL volume/内部连接/127.0.0.1:15433绑定未改变；未运行migration、删除卷或全系统重建。

部署与健康证据：KNOWLEDGE_PERMISSION_UI_DEPLOY.log、KNOWLEDGE_PERMISSION_UI_HEALTH.log、KNOWLEDGE_PERMISSION_UI_DEPLOYMENT.json。

## 真实浏览器验收（8组）

真实Chrome 1440px，现有管理员及普通员工账号，仅运行时使用凭据；没有录屏、trace、storage-state、截图或凭据落盘，账号密码与权限未修改。

管理员6组：登录/当前管理员资格；空间管理恰好一个空间操作权限入口且没有同名权限管理/页面权限按钮；空间平台入口原路由成功及返回原表；实际「人力资源 → 成员与权限」打开原弹窗、四对象三级控件可选后取消；页面与文件独立入口原路由成功及返回工作台；设备模块仍显示默认权限管理。

普通员工2组：登录/当前非Knowledge管理员资格；两个管理页不显示平台配置按钮，直接请求knowledge-spaces与knowledge-pages的permission-context均403。未为员工增加任何权限。

见KNOWLEDGE_PERMISSION_UI_BROWSER.json。验收没有创建业务测试资料或保存授权，因此无业务测试数据需要清理；认证会话按原logout结束，必要认证审计保留。

## 未测试范围与限制

未使用人力资源总监/空间负责人真实账号登录，因为本轮没有该账号运行时凭据；不修改员工账号模拟负责人。负责人FULL_ACCESS不扩张平台权限的场景由专项自动化覆盖，真实管理员已确认人力资源行的新入口可见、可点击。真实Knowledge模块管理员亦由自动化覆盖，未声称对应生产账号登录验证。

没有在生产保存任何Space ACL或平台权限组修改，遵守只调整入口、不改变授权的范围；原保存功能代码/API完全未修改，并由既有相关API回归保留验证。

## 人工查看步骤

1. 刷新知识管理工作台 → 空间管理，顶部应只有「空间操作权限」。
2. 找到人力资源，点击「成员与权限」，确认原对象类型和三级权限仍可操作；无需保存修改。
3. 切换页面与文件，顶部应出现独立「页面与文件操作权限」，其返回链接回到该管理页。
4. 空间负责人须具有原表/字段维护权限才可维护成员，Space FULL_ACCESS本身不会出现平台权限配置入口；普通员工不显示平台按钮。
5. 其他KDOS模块仍使用原「权限管理」文案。

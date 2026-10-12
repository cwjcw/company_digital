# Knowledge Navigation Simplification Acceptance

状态：已完成 / 导航改造已上线，管理员真实浏览器验收通过。日期：2026-10-12（Asia/Shanghai）。

部署 SHA：468af4dd88f0a7b1723d2a0202ee06932b2040ed。

## 原问题与最终交互

门户同时展示左侧文件夹/历史页面树和右侧文件夹列表；管理工作台也同时挂载两类目录树与主列表，形成重复导航。右侧历史页面原来仅有“保留历史子页面”提示，直接移除树会失去明确的子页面入口。

最终门户和管理工作台共用KnowledgeFolderContents：单一主内容区逐层进入文件夹，以完整面包屑返回上级和空间根目录；不再挂载knowledge-directory、KnowledgeFolderTree或KnowledgePageTree作为主页面导航，没有额外“空间根目录”或“返回上级目录”按钮。

管理工作台保留顶部空间选择、新建、上传、模式切换和已有获权管理操作。文件夹使用Folder图标，知识页面/文件使用File图标；文件夹点击进入下一级，页面点击阅读或管理。

上传、在线编写、文档导入、移动操作表单的KnowledgeLocationPicker及其文件夹树、搜索、分页、空目录选择和新建目录能力保留。

## 历史parentId访问

- 根列表仍显示获权的历史父页面，不修改其parentId或folderId。
- 对API返回hasChildren的页面，列表提供“浏览子页面”入口，沿既有parentId逐层浏览；支持继续嵌套、分页和完整路径。
- 进入历史分支前取得相同published/working模式的获权父页面详情，校验其spaceId；父页面无权或不属于当前空间时不请求子列表。
- 历史子列表使用现有tree API的parentId，不误加独立folderId筛选；Folder/Page两类ID始终按面包屑kind分别处理。
- 可以“阅读当前知识”，原/knowledge/pages/:id及历史versionId链接继续有效；历史阅读面包屑和返回分类链接指向正确上级。
- 不将知识页面转换为文件夹，不迁移、删除或隐藏旧页面。原有回收站/归档入口按既有权限保留。

## 布局与设计规则

首页1180px、空间1280px、文章900px、文件1180px、管理1320px保留；margin-inline:auto、手机12～16px外侧安全边距保持。管理操作转为顶部区域，主内容利用受控容器宽度，未变为无限全屏。

按用户要求，在AGENTS.md加入今后KDOS的统一规则：一个业务对象一套主要导航，分类不在左右重复，优先面包屑/单主内容/必要操作，操作表单选择器可保留，删除冗余UI必须保留业务/历史和授权边界。没有修改其他模块页面。

## 修改文件

| 文件 | 改动 |
| --- | --- |
| AGENTS.md | 用户明确要求的未来导航设计规范 |
| apps/web/src/modules/knowledge/KnowledgePortal.tsx | 移除左树/根按钮及重复根查询；使用共享浏览、历史和搜索位置 |
| apps/web/src/modules/knowledge/KnowledgePages.tsx | 管理操作改顶部，移除双树；复用主列表历史分支；保留安全保存/管理权限 |
| apps/web/src/modules/knowledge/KnowledgeFolders.tsx | 统一面包屑/历史子页面/阅读入口及两类ID处理；保留文件夹管理 |
| apps/web/src/modules/knowledge/knowledge.css | 移除门户左树布局；新增受控顶部操作样式，限Knowledge |
| apps/web/src/modules/knowledge/KnowledgeNavigation.spec.tsx | 11项导航、角色、三级/文件/历史/权限/分页/选择器专项 |
| apps/web/src/modules/knowledge/KnowledgePortal.spec.tsx | 空空间单导航断言 |
| apps/web/src/modules/knowledge/KnowledgePages.spec.tsx | 直接发布后验证真实页面状态刷新，替换已移除左树的请求计数断言 |
| apps/web/e2e/knowledge-ui.spec.ts | 三角色Chrome导航，105条分页与六种宽度断言；保留表单树/既有回归 |

另更新outputs/CODEX_PROGRESS.md、本报告和安全验收JSON；源码9文件提交，未push。

无API契约或数据库结构变动，无migration，无新依赖，无ACL/权限体系、草稿、发布/历史版本或文件存储代码修改。API/shared源码与本轮基线一致。

## 自动化结果

- 新增导航专项11项通过；定向3文件59项通过。
- 最终Web全量45文件350项通过。
- Chrome E2E17项通过，1项既有生产凭据门控跳过；实际账号采用独立无录制运行时验收，不把凭据注入测试报告。
- E2E包括普通员工、编辑、管理员单导航，三级目录、历史链接与返回、105条分页，1920/1440/1280/768/390/320px居中和无横向溢出；既有Autosave、直接发布、V1/V2、文件上传及表单位置选择器回归通过。
- Web typecheck、lint、build通过。保留原Portal Fast Refresh、chunk体积、PDF测试环境提示，无新增错误。
- 开发期Ant标签重复定位、原发布测试依赖左树、测试TS窄化/数组下标问题已纠正，最终全量通过。发布测试现在验证发布版本/重复发布按钮状态，不删发布能力检查。
- 本轮未重复运行API全量/数据库migration回归：未修改API或shared；部署也只更新Web。

日志：KNOWLEDGE_NAVIGATION_WEB_ALL.log、E2E.log、TYPECHECK.log、LINT.log、BUILD.log。

## 备份、部署与健康

备份：20261012_200439；项目backup.sh完整备份four_department_tracker、kdos及uploads（含.private），两份pg_restore目录检查、三份SHA256复核、600权限通过。原Web镜像已标记保留回滚。

执行：./scripts/deploy.sh web，返回0。HEAD/Web=468af4dd88f0a7b1723d2a0202ee06932b2040ed；API/Worker仍为7456a4c1eedfdc8abee928b56481006f25630b14（源未改、未重建，不声称全栈同新SHA）。

最终healthcheck.sh通过，四服务healthy、通知Dispatcher active；PostgreSQL与现有运行配置保留，无生产migration、重建数据库或删除卷。

## 真实浏览器验收

真实管理员Chrome8组通过：登录/权限；用现有API创建3级临时目录和仅管理员可见的私密PDF及历史父子页；门户从人力资源逐层进入3级目录；PDF阅读与原件SHA256一致；文件面包屑返回二级和根；真实parentId浏览/阅读/返回；管理顶栏与同一历史列表；1920/1440/390px线上居中/受控宽度/无重复树。

另外用1个临时私密PDF补充严格渲染检查：画布确有非透明、非白色文档像素，排除未渲染空白canvas，通过并清理。总计4个自建页面、3个自建文件夹按自建ID/唯一前缀及创建人保护，仅通过现有API清理，未触碰原有资料；必要审计、上传幂等记录和文件夹删除墓碑保留。

真实普通员工：E2E登录/权限验证通过，空间API200、知识页面API403；前端明确拒绝并隐藏管理/目录操作。该账号现有Knowledge页面读取权限不足，故其生产正向目录/文件阅读为NOT_TESTED，未修改授权。生产独立编辑账号未登录，编辑场景通过角色自动化覆盖，不声称其生产账号验收通过。

凭据仅运行时输入；没有输出用户名/密码/token，没有截图、trace、video、storageState或凭据文件；按现有logout结束。

## 原有资料完整性

维护只读快照，仅保存记录完整行JSON的MD5及数量，不保存正文或存储内容。全部14张Knowledge表的每条原有记录摘要部署前后均保留，原页面5、版本3、文件4、预览3及关联/ACL等原数据完整。

符合模型的新增保留：3个已删除测试文件夹墓碑（12→15），2条测试上传幂等记录（63→65）及必要审计；没有存活测试页面/文件，knowledge_storage_cleanup仍为0。没有为了让计数相同而删除墓碑、幂等或审计。

证据：KNOWLEDGE_NAVIGATION_BACKUP.json、DEPLOYMENT.json、BROWSER.json、PDF.json、EMPLOYEE.json、DATA_BEFORE.json、DATA_AFTER.json、INTEGRITY.json。

## 人工复验

1. 进入知识库→人力资源：只有主内容区文件夹/文件列表，无左侧重复知识目录或根按钮。
2. 点击考勤制度及下级目录，使用面包屑返回上级、返回人力资源；点击获权文件进入阅读页，再用阅读面包屑返回。
3. 管理工作台选择人力资源：空间选择和管理操作在顶部，目录仍用同一列表。
4. 有历史子页面的知识点击“浏览子页面”，逐级查看并阅读；旧分享链接、历史版本继续按原权限访问。
5. 新建/上传/导入表单内点击更改位置，确认层级选择器仍可用。

未执行的生产员工正向/独立编辑登录范围及原因如上，相关授权未改变；无本轮开发或部署遗留。

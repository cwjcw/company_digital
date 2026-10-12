# Knowledge legacy tree SQL fix

状态：已完成 / PASS。已备份、部署并通过真实管理员浏览器验收。

## 根因与最小修复

`knowledge.query.service.ts` 的 list legacyOnly分支将已构建的权限表达式从 record/published 改名为 legacy_child/legacy_published。旧全局 `/published\./g` 也匹配 ancestor_published 中的后缀，造成引用成为 ancestor_legacy_published，JOIN声明仍为ancestor_published，PostgreSQL抛42P01。

仅修改三个正则匹配边界：list中使用 `/\brecord\./g`、`/\bpublished\./g`；同文件详情历史版本表达式替换也使用 `/\bpublished\./g`。同文件另一个replace为搜索词转义，与SQL别名无关，保留。

不删除或弱化任何ACL条件，不改变租户参数、递归祖先查询、字段/数据范围、发布快照及parentId历史兼容。无API契约、数据库结构、migration、依赖、前端或文件存储改动。

## 修改文件

- apps/api/src/modules/knowledge/knowledge.query.service.ts：两个代码位置，三个正则增加边界。
- apps/api/src/modules/knowledge/knowledge.legacy-tree.spec.ts：5项完整生成SQL和权限专项。
- apps/api/src/modules/knowledge/knowledge.folders.database-validation.ts：既有真实数据库回归器新增5组历史目录场景。
- outputs/CODEX_PROGRESS.md、本报告及安全JSON验收证据。

## 测试与构建

- 单元5项：published/working × 管理员/受限成员 × legacyOnly布尔/字符串；检查完整count/rows SQL中的JOIN别名、祖先引用、租户、递归和ACL；正常列表/子分支不加legacy根过滤；working仍要求更新权限。
- 最终API全量：102套875项通过，1项既有跳过。
- API typecheck、lint、build：通过。初次专项测试有资源数组推断为string的测试类型错误，已加as const，最终质量检查通过。
- Web源未改，未重复跑Web单元/build；真实管理员页面6组验收通过。

### 独立 PostgreSQL 18

临时独立postgres:18容器，network=none、无发布端口；数据仅tmpfs，使用权限700的临时根目录下Unix socket连接，未连接生产卷。通过既有scripts/validate-knowledge.mjs及真实Application/Query/Authorization服务执行完整SQL，不mock数据库结果。

123组真实PG场景通过；86个既有迁移在第二个临时空库重放通过，仅测试基线，并非本次新增迁移或生产执行。

新增5组覆盖：

1. legacyOnly无历史子页面时双模式均返回0，不报42P01。
2. 只有草稿历史子页面时working有目录、published不泄露。
3. 发布后双模式count/list/hasChildren及子分支均正确。
4. 普通用户看不到私密父/子页面或隐藏计数；只读working拒绝；只有表更新权限但Space只读时working为空。
5. CUSTOM标题数据范围的ancestor_published字段与其他租户隔离均由真实SQL验证。

已有真实回归还覆盖历史版本、未发布移动、权限快照、文件/预览/幂等及真正非owner角色RLS。第一次全量运行在第69项后因新GIN索引pending list导致已有natural planner断言失败；临时测试运行器仅在隔离库EXPLAIN前调用gin_clean_pending_list，正常合并索引待写条目后自然规划选择GIN，最终123项通过；未修改生产SQL、数据库配置、优化器开关或相关测试断言。

两个knowledge_test_*临时数据库已由带前缀保护的标准runner删除，残留0；测试容器已停止并移除。生产资料未写入。证据：KNOWLEDGE_LEGACY_TREE_DATABASE.json、KNOWLEDGE_LEGACY_TREE_ISOLATION.json及DATABASE_FINAL.log。

## 备份与部署

完整备份：20261012_133754，four_department_tracker/kdos custom dumps及uploads含.private；两份pg_restore目录检查、三个SHA256复核、文件权限600通过。API/Worker原b1b8447镜像已标记保留回滚。证据：KNOWLEDGE_LEGACY_TREE_BACKUP.json。

源码提交：7456a4c1eedfdc8abee928b56481006f25630b14，3个相关源码/测试文件，未push。使用标准./scripts/deploy.sh api，仅API和配套Worker；不重建Web或PostgreSQL。

实际部署：标准deploy.sh api返回0，HEAD/API/Worker均为7456a4c1eedfdc8abee928b56481006f25630b14。Web保留ca0d7d7d9ab99aaf0eadf076aed443525826c482，已核对Web/shared源码不变，未为SHA重建Web。PostgreSQL原容器/挂载/127.0.0.1:15433映射保持，未执行生产migration。

healthcheck.sh通过：Web/API/Worker/PostgreSQL均healthy，通知Dispatcher active。新API日志中受影响的ancestor_legacy_published/missing FROM-clause错误为0。证据：KNOWLEDGE_LEGACY_TREE_DEPLOYMENT.json、DEPLOY.log、HEALTH.log。

### 真实管理员验收

真实Chrome运行6组全部通过：

1. E2E登录/权限验证通过。
2. 管理工作台选择实际“人力资源”，已发布历史目录正常，无Internal server error。
3. 切换“工作页面（含草稿）”，真实legacyOnly目录请求200。
4. 实际点击“考勤制度”文件夹，进入正确目录，working请求200，无Internal server error。
5. 同目录切回“已发布页面”，真实目录请求200。
6. 真实API空间根/考勤目录 × published/working 四种legacyOnly请求全部200；浏览器Knowledge请求无500。

证据：KNOWLEDGE_LEGACY_TREE_BROWSER.json，内含实际部署SHA和安全请求状态。账号凭据仅运行时输入，未存入源码/文件/报告，未启用截图/录像/trace/storageState，验收后按既有logout退出；浏览器只允许业务GET，未提交业务写入或授权修改。

### 既有资料完整性

部署前后只读计算全部14张Knowledge表的记录数及完整行JSON MD5指纹，全部完全一致；人力资源的页面/文件夹元数据也完全一致。覆盖历史页面、文件、版本、ACL、预览和关联；未删除旧资料或以前遗留测试目录，未进行数据修正。

证据：KNOWLEDGE_LEGACY_TREE_DATA_BEFORE.json、DATA_AFTER.json、DATA_INTEGRITY.json。

## 人工复验

1. 登录Knowledge管理工作台，知识空间选择“人力资源”。
2. 点击实际已有文件夹“考勤制度”，确认内容区和目录区没有Internal server error。
3. 分别选择“已发布页面”“工作页面（含草稿）”，确认切换正常、目录请求成功。
4. 保持既有历史页面及权限配置，检查获权的旧父子页面可以展开；未授权内容不可见。

未测试：生产普通员工真实登录；受限成员、字段范围、只读working和RLS由自动化及独立PG覆盖；不修改员工授权，不创建/删除生产验收资料。

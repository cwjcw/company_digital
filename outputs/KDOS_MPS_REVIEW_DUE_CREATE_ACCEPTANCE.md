# KDOS-MPS-REVIEW-DUE-CREATE-001 验收记录

状态：实施与发布验证进行中；最终交付状态为WAITING_MANUAL_ACCEPTANCE，自动验证不能代替用户人工验收。

起始SHA：d6d736988f0c7eeb7334bc221b8a0fb5f06b645b。用户参考3c46692之后仅有文档同步提交；实际开始工作区干净。

## 实现与边界

- 评审交期表现有KdosDataTable工具栏增加“新增”，与搜索、高级筛选、导出共用一处；空表可新增。六字段表单沿用contracts定义和标准Modal/Form；订单号、批次号、试制计划图号、入库时间、数量必填，验货时间名称可空，日期选择器及精确十进制文本输入。
- 独立POST `/api/v1/master-plan-system/review-due-dates/manual-create` 进入ReviewDueDateApplicationService.manualCreate。原资源create:false保留；通用新增、通用PATCH、批量、Excel导入、删除继续拒绝，包括管理员。
- 服务端生成UUIDv7、tenant及真实登录用户审计；初始changeCount=0，previousInboundDate/lastChangedAt/lastSyncedAt=NULL，首次新增无交期历史。客户端统计/来源/审计/version字段一律400。
- 资源create、所有必要字段填写授权、已提交可选字段授权、当前租户有效用户及拟新增记录create数据范围全部检查。填写授权沿用字段read或update，不要求既有记录update。管理页可配置create，不改生产权限组。只新增用户仅获取创建元数据，不获列表、历史、导出权限。
- 原current业务三键及不可变source三键均保持租户唯一，重复409且不合并/覆盖。数据库现有103号迁移和INSERT来源初始化触发器足够，无需新迁移，不修改历史迁移/RLS/保护触发器；生产ledger=103，最近迁移MpsReviewDueDateManualEdit1722920104000，两表FORCE RLS及5保护触发器确认存在。
- 租户+用户+commandId事务锁与持久幂等收据；同内容重试返回同ID，不同内容复用409。行、正式创建审计及收据同事务，审计失败完整回滚。网页同步ref阻止连续点击，失败保留草稿并复用同内容的commandId，成功后刷新并关闭。
- 不可变初始来源身份与可编辑业务键分离；MANUAL创建审计且最近同步时间为空。未来observe命中人工新增记录时409要求来源身份人工核实，不自动认为已同步；身份确认命令、导入和每日同步不在本任务内。

## 验证

已通过：

- API全量：120 suites、1179项通过；既有4 suites/33项跳过。
- Contracts：32项通过。
- Web全量覆盖62文件/455项：首轮454通过，原编辑测试1项在异步查询返回后持有已被刷新替换的DOM而失败；修正测试为waitFor内同步重新查询，保持原六字段可见断言不变，该组5项重跑全过。其余61文件无需重复运行；全部455项已验证通过，原始失败及重跑日志保留。新增5项、原页面6项亦通过。
- 隔离PostgreSQL+真实HTTP+真实Chrome：43组通过，包含非空旧结构升级、UUIDv7、管理员/普通授权创建、无资源/字段授权403、拟新增数据范围、跨租户、必填/日期/Decimal、重复409、并发和收据幂等、审计与回滚、计数0/无初始历史/NULL同步、手工编辑及来源保护、RLS、历史不可变和Excel十字段全量导出。
- Chrome连接隔离HTTP真实填写六字段，验证必填修正、双击一次POST、精度、成功关闭刷新、重复冲突保留草稿，以及原六字段编辑/版本冲突刷新/交期历史。

递归typecheck、lint、build均通过。lint只有既有ModulePortal Fast Refresh一项警告，0错误；构建保留既有大包提示。

待补发布结果：生产Chrome/保护复核、GitHub同步。

## 生产保护与证据

- 开发前标准两库及uploads备份20261022_084434完成，恢复目录/压缩格式/SHA及600权限检查通过；文件仅在私有data/backups，不进入Git。
- 发布前两库/uploads备份20261022_090128完成，恢复目录/SHA/gzip及600权限检查通过。
- 生产基线及发布前复核：主表0、历史0；9项授权/PMC映射保护表、6项同步flags及8项财务视图定义一致。
- 所有写入测试仅在独立postgres:18容器/Unix socket `/tmp/kdos-review-due-pg-create-20261022`，隔离数据库自动清理，容器/卷/临时socket已清理；真实生产浏览器只允许读请求及填表取消，不提交演示记录。
- 不导入1139条、不启动每日同步/ERP、不改生产授权或现有财务公式，不改其他主计划表。
- 私有执行证据：data/mps-review-due-create-20261022（ignored，含日志/保护哈希/浏览器结果，不提交业务数据或认证资料）。

## 修改文件

- Contracts：review-due-dates.ts、index.ts、review-due-dates.spec.ts。
- API：master-plan.types.ts、master-plan.query.service.ts、master-plan.application.service.ts；review-due-date.application.service.ts、controller.ts、query.service.ts、domain.ts及create/domain/manual测试。
- Web：ReviewDueDates.tsx及ReviewDueDates.create.spec.tsx、ReviewDueDates.edit.spec.tsx（仅修正刷新竞态测试定位）。
- 隔离验证：scripts/test-review-due-dates-postgres.cjs。
- 文档：本报告、CODEX_PROGRESS.md、KDOS_MPS_REVIEW_DUE_DATE_SPEC.md、docs/integration-guide.md。

## 用户人工验收

完成发布与自动验证后等待用户在已授权权限下自行新增业务记录并人工验收。部署验收期间正式两表始终0/0，不以测试制造记录。最终状态WAITING_MANUAL_ACCEPTANCE；完成后停止，不进入首次导入或每日同步。

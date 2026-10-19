# KDOS 财务E10订单头指定结束修复

日期：2026-10-19（Asia/Shanghai）。起始HEAD/Web/API为`9b867d370ed8044a0413d3c0506fd05108100a22`，工作区干净。状态：本地开发与验证完成，准备正式部署和生产FULL刷新。用户已明确追加授权：仅提交本任务、push并部署。

## 根因与规则

原34列结束码来自交货计划`SALES_ORDER_DOC_SD.[CLOSE]`；没有保存订单头`SALES_ORDER_DOC.[CLOSE]`。新的内部`headerCloseCode`独立于原结束码，采集继续保留所有原始品项。`FinanceE10SpecifiedClose1722920095000`只替换`finance_e10_monthly`派生视图：保留原待复核/重复/缺失排除条件，再按租户+账套+来源订单UUID对原始元数据执行NOT EXISTS指定结束码1，整单排除。头码0/2/NULL及未知码不因结束状态被排除。月度、大屏全部维度、动态客户排名、平台Excel/打印共同使用同一关系，原始34列和月度9列不变。

新采集页校验头状态键、类型和长度；发布前还检查全部暂存页，防止升级前失败批次断点续读混入缺少头状态的旧页。此时原发布数据保留，提示全量重新读取。FULL及原增量仍通过现有Finance Application Command发布，头/品项/交货计划修改会重读影响订单全部品项。

## 已先报告的审核差异

标准SQL有`ApproveStatus='Y'`；当前财务模型不按审核状态排除。本次继续保留原审核范围，不另加Y限定；标准SQL还有G%客户过滤，也不擅自引入。金额仍为本币未税+税额合计，日期仍为既有业务日期/MIN预交期。外部标准SQL与ERP只读，不修改ERP、客户分类、平台权限或同步flags。

## 验证

- API full：109套1016通过，33默认外部集成skip；相关真实PostgreSQL另行启用。
- PostgreSQL：订单22场景、客户/完整fresh迁移20场景通过，fresh共94迁移；指定关闭整单、头/交货码不同、0/2/NULL、不增加审核限制、状态往返、tenant/账套、原始保留、Excel与断点旧页保护全部覆盖。
- Web full：54套407通过。首次默认5s有超时和随后时序失败；本次CLI `--maxWorkers=1 --testTimeout=15000`复测全部通过，未改任何Web源码或断言。财务Chrome5、Python4、Contracts29通过。
- 全仓typecheck/lint/build通过；最后Application发布保护再次API build/typecheck/lint/full与PG订单22通过。只有既有Portal FastRefresh、Vite chunk及ts-jest提示。
- 真实同一E10账套2025+完整源数据已只读采集并验证。受限隔离库在同一数据集上执行新迁移，原始、月度、大屏月份/事业部/渠道/矩阵、排名及两类实际Excel总额一致；正常结束保留。实际财务数量/金额仅在`data/finance-header-close-20261019/capture-validation.json`及受限验收报告，不入Git。生产数据仍须正式FULL发布后核验，不能把隔离结果称为已上线。

## 发布与回滚

双库custom与uploads标准备份`20261019_105935`，pg_restore目录及3项SHA256通过。生产迁移计划只有新94号，当前无财务RUNNING批次。先提交/普通push本任务文件，迁移仅派生视图，再标准all/check、正式Finance FULL Command、真实报表与Excel/健康验证。回滚仅恢复派生视图旧政策/原应用镜像；不删原始品项或审计，不恢复覆盖生产数据库。没有新增自动调度入口，FIN-002仍手动，既有任务不变。

## 修改文件

Reader及Python回归；Finance Application验证、unit与迁移unit、新94号视图迁移；两套隔离PG脚本与合成验证JSON；implementation、任务台账、本进度和本报告。真实财务文件、NDJSON、xlsx、备份、凭据与私有工具脚本均不提交。最终SHA及生产发布结果于上线完成后补充。

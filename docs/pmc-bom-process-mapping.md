# 事业四部一级BOM工序对应

## 使用入口

在「在制订单进度」展开事业四部订单，点击已建立月计划的产品品号，进入「一级BOM工序匹配」。页面显示一级子件、来源工序、事业部对应关系及本产品现有报工进度。配置表位于主计划系统「数据准备 → 事业部ERP工序映射」，支持已有通用新增、编辑、删除、Excel模板、预览确认导入和导出。

本期只接入科加 `tplus-kejia` / `UFTData418971_000003`。绑定键为租户、事业部、来源账套、ERP工序编码；其他事业部不会继承事业四部绑定。2026-10-26用户确认：碰焊对应KDOS焊接，烤漆对应表面处理；包装对应包装。其他来源工序保留待绑定，由业务人员选择标准工序或明确不参与内部报工。

## 来源与进度口径

- 正式月计划和授权订单/品项是查询入口；科加ERP来源行必须唯一，按来源明细ID、订单号、品号同时核对。
- 主BOM优先使用加工单品项实际引用，其次订单明细BOM，最后唯一启用默认BOM。不同版本不能自动选第一个。
- 只查询该主BOM的 `AA_BOMChild` 一级记录，不递归展开。子件工序优先取同一订单来源的加工单实际工序；否则取子件BOM工序、加工单/BOM关联路线、子件默认路线。多个执行结构或版本矛盾显示歧义，不混合。
- 来源表：`AA_InventoryEntity`、`AA_BOM`、`AA_BOMChild`、`AA_BOMProcess`、`AA_Routing`、`AA_Routing_b`、`AA_Process`、`SA_SaleOrder(_b)`、`MP_ManufactureOrder(_b)`、`MP_ManufactureOrder_Process`。关联字段已在科加真实库核实。
- 多个子件/来源工序映射到同一KDOS标准工序时，产品仅展示一次。进度直接沿用现有订单进度服务的月计划需求、现有有效报工数量、状态和日期；不生成子件任务，不把产品报工复制/分摊给子件，不重写周计划快照。
- 「碰焊→焊接」不会把历史「点焊」报工改成焊接。历史实际未在焊接下报工时，焊接数量按现有汇总显示，不用相近工序凑数。状态和比例保留现有独立口径，比例不强制封顶100%。
- 无路线/来源歧义/待绑定均有明确显示，不表示已完成。不根据同时存在的自制/采购标志推断生产方式；采购入库跟踪沿用现有链路。

## 权限、接口和运维

- 查看沿用 `mps-order-progress-dashboard` 的read权限、数据范围、`bomConfiguration`及订单/品号/事业部字段权限；数量/状态继续受各标准工序字段权限控制。
- 配置使用独立资源 `mps-external-process-mappings`，沿用字段权限、行范围、审计、乐观版本和统一加密文件检测。行内保存按钮按实际创建/修改能力和数据范围显示，后端命令再次校验。
- `GET /master-plan-system/order-progress/bom-process?orderId=&itemId=`；各表通过 `/bom-process/export/{children|bindings|progress}` 服务端导出，表名白名单、read∩export范围、业务显示值、导出审计。
- 新表 `mps_external_process_mappings` 有tenant上下文/RLS、共享组织目录外键、事业部操作范围校验和唯一约束；Migration `1722920109000`及兼容修复`1722920110000`（组织目录本身没有tenant_id，不为本功能重建组织体系）。回退存在配置时会拒绝丢弃，先保护配置再决定回退。
- 来源读取在Integration Adapter内完成，使用共享basic_code的MSSQLDatabase配置和既有TPLUS_SQL环境；T+只读。API镜像复用已安装Python/pytds和basic_code只读挂载。
- TDS优先复用共享工具包内与运行时Python小版本一致的已验证客户端（当前python-tds 1.17.1）；避免容器发行版旧客户端的prelogin超时，不安装新框架。
- 当前T+ Cloudflare隧道保留宿主机loopback监听。`bash automation/tplus_bom_proxy/install.sh` 注册用户级systemd Socket及按需激活的systemd-socket-proxyd，使用独立的本地Unix socket转接原loopback SQL端口；API通过只读目录挂载连接，不新增TCP监听或修改防火墙，不复制凭据，不改变原隧道。Compose仅给BOM reader设置非密钥 `TPLUS_BOM_SQL_SOCKET`；其他同步保持原连接。凭据已注入时不读取不可读的工具包.env。回退先回退应用，再停用`kdos-tplus-bom-proxy.socket`及同名service。主机重启由现有Linger用户服务自动激活，首次安装先于Compose部署。
- 用户打开详情才读取，不新增调度入口、不改现有ERP同步；同请求合并，来源缓存最长120秒、上限100个键，输出8MB上限/120秒超时。观察时间在页面显示，配置映射重新从KDOS读取。

## 定向验收

后端 `master-plan.bom-process.spec.ts`、前端 `MasterPlanBomProcesses.spec.tsx`、Python `test_kejia_bom_reader.py` 覆盖范围/字段授权、部门隔离、未绑定/忽略、去重、命令校验/审计/乐观锁、保存/重复点击/错误提示和一级读取。隔离PostgreSQL及真实Chrome的本轮证据保留于 `test/`，真实ERP数据不入Git。

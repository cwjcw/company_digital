# 事业部BOM统计

复用rd-order-bom-report/divisions及既有表格，事业部归属来自mps_order_allocations；组内按订单号+原始品号去重，不按ERP来源计数。基础来源、授权、同步及回滚遵守同目录订单BOM明细合同。无编辑、缓存草稿、导入、删除、附件或子表。

每字段仅read、无人工覆盖、不脱敏、重复允许、按字段read显隐、隐藏不清空。所有字段复用当前资源read∩export/租户/范围、筛选排序、个人列配置和服务端全部匹配导出；无成员可新增选项，无额外触发事件或多标签编辑。

|中文/英文key|来源/关系与公式|类型/必填/默认/提示|
|---|---|---|
|承接事业部 divisionId|分配division_id→组织名，组键|部门单选只读，可空显示待匹配|
|订单数量 orderCount|分配订单号去重|普通数字0位，默认0|
|品号总数 itemCount|不同订单+品号组合数|普通数字0位，默认0|
|有BOM数量 existingBomItemCount|组合统一Y数量|普通数字0位，默认0|
|无BOM数量 missingBomItemCount|组合统一N数量，含暂未核验|普通数字0位，默认0|
|未核验数量 unmatchedBomItemCount|N且来源存在失败/未初始化/过期，为N子集|普通数字0位，默认0，独立辅助量|
|BOM完成率 completionRate|Y/全部组合×100，空组null|百分比2位|
|平均BOM等待天数 averageBomWaitingDays|仅唯一可靠审核日的Y组合等待天数平均|普通数字2位，可空；多来源/多版本不参与|
|同步状态 sourceSyncStatus|三来源独立最后成功日期/正常异常过期|文本必有，不推送消息|

三表使用同一统一匹配器和同一范围；部门不因BOM来源变化。仅统计报表不增加删除。

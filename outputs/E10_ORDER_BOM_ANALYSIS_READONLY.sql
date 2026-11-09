/*
  E10 销售订单 -> BOM 关系/时间只读核查
  数据库：通过现有只读适配器核验为 E10_6.0.0.1.NEW.CHS
  本文件只包含 SELECT / CTE；不要在生产控制台中改写为 DML。
  不依赖未确认的外键，关联使用本次实测的 UUID 业务键。
*/

SELECT DB_NAME() AS database_name;

/* 一、相关表与字段：订单、品项、工厂物料、BOM、工程变更 */
SELECT s.name AS schema_name, t.name AS table_name, c.column_id,
       c.name AS column_name, TYPE_NAME(c.user_type_id) AS type_name,
       c.is_nullable
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id=t.schema_id
JOIN sys.columns c ON c.object_id=t.object_id
WHERE t.name IN (
  'SALES_ORDER_DOC','SALES_ORDER_DOC_D','ITEM','ITEM_PLANT',
  'BOM','BOM_D','BOM_PRODUCT','BOM_AUTO_CONFIG','BOM_AUTO_CONFIG_D',
  'BOM_MANUAL_CONFIG','BOM_MANUAL_CONFIG_D','HISTORY_BOM_D',
  'ECN','ECN_D','ECN_SD','ECN_SSD','ECN_BOM_SD'
)
ORDER BY t.name,c.column_id;

/* 实际声明的外键；本次相关核心表的查询结果为空。 */
SELECT OBJECT_NAME(f.parent_object_id) AS child_table,
       COL_NAME(fc.parent_object_id,fc.parent_column_id) AS child_column,
       OBJECT_NAME(f.referenced_object_id) AS parent_table,
       COL_NAME(fc.referenced_object_id,fc.referenced_column_id) AS parent_column
FROM sys.foreign_keys f
JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
WHERE OBJECT_NAME(f.parent_object_id) IN
 ('SALES_ORDER_DOC','SALES_ORDER_DOC_D','ITEM','ITEM_PLANT','BOM','BOM_D')
   OR OBJECT_NAME(f.referenced_object_id) IN
 ('SALES_ORDER_DOC','SALES_ORDER_DOC_D','ITEM','ITEM_PLANT','BOM','BOM_D')
ORDER BY child_table,child_column;

/* 二、已验证的关系和值域 */
SELECT COUNT_BIG(*) AS bom_detail_rows,
       COUNT(i.ITEM_BUSINESS_ID) AS source_item_uuid_matches,
       COUNT(DISTINCT d.SOURCE_ID_ROid) AS distinct_component_item_ids,
       SUM(CASE WHEN d.QTY_PER<=0 OR d.DENOMINATOR<=0 THEN 1 ELSE 0 END) AS invalid_usage_rows
FROM dbo.BOM_D d
LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.SOURCE_ID_ROid;

SELECT d.SOURCE_TYPE,d.ITEM_TYPE,d.ITEM_CATEGORY,COUNT_BIG(*) AS detail_rows,
       COUNT(i.ITEM_BUSINESS_ID) AS source_item_uuid_matches
FROM dbo.BOM_D d
LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.SOURCE_ID_ROid
GROUP BY d.SOURCE_TYPE,d.ITEM_TYPE,d.ITEM_CATEGORY
ORDER BY detail_rows DESC;

/* 三、审核/有效期状态与时间字段质量 */
SELECT 'BOM' AS entity,ApproveStatus,COUNT_BIG(*) AS rows,
       SUM(CASE WHEN ApproveDate='1900-01-01' THEN 1 ELSE 0 END) AS approve_date_1900,
       SUM(CASE WHEN ApproveBy='00000000-0000-0000-0000-000000000000' THEN 1 ELSE 0 END) AS zero_approver
FROM dbo.BOM GROUP BY ApproveStatus
UNION ALL
SELECT 'BOM_D',ApproveStatus,COUNT_BIG(*),
       SUM(CASE WHEN ApproveDate='1900-01-01' THEN 1 ELSE 0 END),
       SUM(CASE WHEN ApproveBy='00000000-0000-0000-0000-000000000000' THEN 1 ELSE 0 END)
FROM dbo.BOM_D GROUP BY ApproveStatus;

SELECT ApproveStatus,COUNT_BIG(*) AS bom_rows,
       MIN(ApproveDate) AS earliest_approve_date,MAX(ApproveDate) AS latest_approve_date
FROM dbo.BOM GROUP BY ApproveStatus ORDER BY ApproveStatus;

SELECT COUNT_BIG(*) AS item_org_pairs_with_multiple_bom_heads,
       MAX(bom_count) AS max_bom_heads_per_item_org
FROM (
  SELECT ITEM_ID,Owner_Org_ROid,COUNT_BIG(*) AS bom_count
  FROM dbo.BOM GROUP BY ITEM_ID,Owner_Org_ROid HAVING COUNT_BIG(*)>1
) x;

SELECT COUNT_BIG(*) AS bom_heads,
       SUM(CASE WHEN BOM_CHANGE_D_ID='00000000-0000-0000-0000-000000000000' THEN 1 ELSE 0 END) AS zero_ecn_reference,
       SUM(CASE WHEN ed.ECN_D_ID IS NOT NULL THEN 1 ELSE 0 END) AS linked_to_ecn_detail
FROM dbo.BOM b
LEFT JOIN dbo.ECN_D ed ON ed.ECN_D_ID=b.BOM_CHANGE_D_ID;

SELECT 'HISTORY_BOM_D' AS entity,COUNT_BIG(*) AS rows FROM dbo.HISTORY_BOM_D
UNION ALL SELECT 'ECN',COUNT_BIG(*) FROM dbo.ECN
UNION ALL SELECT 'ECN_D',COUNT_BIG(*) FROM dbo.ECN_D
UNION ALL SELECT 'ECN_SD',COUNT_BIG(*) FROM dbo.ECN_SD
UNION ALL SELECT 'ECN_SSD',COUNT_BIG(*) FROM dbo.ECN_SSD
UNION ALL SELECT 'ECN_BOM_SD',COUNT_BIG(*) FROM dbo.ECN_BOM_SD;

/* 四、订单品项样本（最近已审核订单，最多 30 张订单、每单首个明细） */
WITH approved_order_lines AS (
  SELECT h.SALES_ORDER_DOC_ID,h.DOC_NO,h.ORDER_DATE,h.CreateDate AS order_created_at,
         h.LastModifiedDate AS order_last_modified_at,h.ApproveStatus AS order_status,
         h.ApproveDate AS order_approved_at,h.Owner_Dept,
         d.SALES_ORDER_DOC_D_ID,d.SequenceNumber,d.ITEM_ID,d.ITEM_FEATURE_ID,
         d.CreateDate AS line_created_at,d.ApproveStatus AS line_status,d.ApproveDate AS line_approved_at,
         i.ITEM_CODE,i.ITEM_NAME,i.ITEM_SPECIFICATION,
         ROW_NUMBER() OVER(PARTITION BY h.SALES_ORDER_DOC_ID
                           ORDER BY d.SequenceNumber,d.SALES_ORDER_DOC_D_ID) AS line_rank,
         DENSE_RANK() OVER(ORDER BY h.ORDER_DATE DESC,h.DOC_NO DESC) AS order_rank
  FROM dbo.SALES_ORDER_DOC h
  JOIN dbo.SALES_ORDER_DOC_D d ON d.SALES_ORDER_DOC_ID=h.SALES_ORDER_DOC_ID
  LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.ITEM_ID
  WHERE h.ApproveStatus='Y'
    AND h.ORDER_DATE>=DATEADD(year,-5,CONVERT(date,GETDATE()))
), sample AS (
  SELECT TOP (30) * FROM approved_order_lines
  WHERE line_rank=1 ORDER BY order_rank
)
SELECT s.DOC_NO AS order_no,s.ORDER_DATE,s.order_created_at,s.order_approved_at,
       s.SequenceNumber AS line_number,s.ITEM_CODE,s.ITEM_NAME,
       s.ITEM_FEATURE_ID,
       ip.ITEM_PROPERTY,ip.ITEM_ROUTING_CONTROL,
       CONVERT(varchar(36),b.BOM_ID) AS bom_id,b.VERSION_TIMES,b.ApproveStatus AS bom_status,
       b.CreateDate AS bom_created_at,b.ApproveDate AS bom_approved_at,
       b.LastModifiedDate AS bom_last_modified_at,
       COUNT_BIG(bd.BOM_D_ID) AS bom_detail_count,
       SUM(CASE WHEN bd.ApproveStatus='Y' THEN 1 ELSE 0 END) AS approved_detail_count,
       MIN(bd.EFFECTIVE_DATE) AS min_detail_effective_date,
       MAX(bd.EXPRITY_DATE) AS max_detail_expiry_date
FROM sample s
LEFT JOIN dbo.ITEM_PLANT ip ON ip.ITEM_ID=s.ITEM_ID
LEFT JOIN dbo.BOM b ON b.ITEM_ID=s.ITEM_ID AND b.Owner_Org_ROid=ip.Owner_Org_ROid
LEFT JOIN dbo.BOM_D bd ON bd.BOM_ID=b.BOM_ID
GROUP BY s.DOC_NO,s.ORDER_DATE,s.order_created_at,s.order_approved_at,s.SequenceNumber,
         s.ITEM_CODE,s.ITEM_NAME,s.ITEM_FEATURE_ID,ip.ITEM_PROPERTY,ip.ITEM_ROUTING_CONTROL,
         b.BOM_ID,b.VERSION_TIMES,b.ApproveStatus,b.CreateDate,b.ApproveDate,b.LastModifiedDate
ORDER BY s.ORDER_DATE DESC,s.DOC_NO,s.SequenceNumber;

/* 五、BOM 子件递归核查入口：SOURCE_ID_ROid → ITEM.ITEM_BUSINESS_ID。
   根据 E10 实测物料属性确定是否继续递归；不要把全部子件都视为需下阶 BOM。 */
DECLARE @RootBomId uniqueidentifier = NULL; -- 替换为要复核的 BOM_ID
SELECT d.SequenceNumber,d.SOURCE_TYPE,d.ITEM_TYPE,d.ITEM_CATEGORY,
       d.SOURCE_ID_RTK,CONVERT(varchar(36),d.SOURCE_ID_ROid) AS component_item_id,
       i.ITEM_CODE,i.ITEM_NAME,ip.ITEM_PROPERTY,ip.ITEM_ROUTING_CONTROL,
       d.QTY_PER,d.DENOMINATOR,d.ApproveStatus,d.EFFECTIVE_DATE,d.EXPRITY_DATE,
       COUNT(cb.BOM_ID) AS child_bom_candidates,
       SUM(CASE WHEN cb.ApproveStatus='Y' THEN 1 ELSE 0 END) AS approved_child_boms
FROM dbo.BOM_D d
LEFT JOIN dbo.ITEM i ON i.ITEM_BUSINESS_ID=d.SOURCE_ID_ROid
LEFT JOIN dbo.ITEM_PLANT ip ON ip.ITEM_ID=i.ITEM_BUSINESS_ID
LEFT JOIN dbo.BOM cb ON cb.ITEM_ID=i.ITEM_BUSINESS_ID
                    AND cb.Owner_Org_ROid=ip.Owner_Org_ROid
WHERE @RootBomId IS NOT NULL AND d.BOM_ID=@RootBomId
GROUP BY d.SequenceNumber,d.SOURCE_TYPE,d.ITEM_TYPE,d.ITEM_CATEGORY,d.SOURCE_ID_RTK,
         d.SOURCE_ID_ROid,i.ITEM_CODE,i.ITEM_NAME,ip.ITEM_PROPERTY,ip.ITEM_ROUTING_CONTROL,
         d.QTY_PER,d.DENOMINATOR,d.ApproveStatus,d.EFFECTIVE_DATE,d.EXPRITY_DATE
ORDER BY d.SequenceNumber;

/* 六、工程变更关联：BOM.BOM_CHANGE_D_ID → ECN_D.ECN_D_ID → ECN.ECN_ID。
   ECN_SD.BOM_SEQ_ID 对当前 BOM_D_ID 值域匹配；该链只覆盖实际关联的变更，不代表全历史。 */
SELECT e.DOC_NO,e.DOC_DATE,e.CreateDate AS ecn_created_at,e.ApproveDate AS ecn_approved_at,
       e.ApproveStatus AS ecn_status,ed.CHANGE_TYPE,ed.ORIGINAL_VERSION_TIMES,
       ed.VERSION_TIMES,ed.CreateDate AS ecn_detail_created_at,
       ed.ApproveDate AS ecn_detail_approved_at,
       COUNT(sd.ECN_SD_ID) AS component_change_rows
FROM dbo.ECN e
JOIN dbo.ECN_D ed ON ed.ECN_ID=e.ECN_ID
LEFT JOIN dbo.ECN_SD sd ON sd.ECN_D_ID=ed.ECN_D_ID
WHERE e.ApproveStatus='Y'
GROUP BY e.DOC_NO,e.DOC_DATE,e.CreateDate,e.ApproveDate,e.ApproveStatus,
         ed.CHANGE_TYPE,ed.ORIGINAL_VERSION_TIMES,ed.VERSION_TIMES,
         ed.CreateDate,ed.ApproveDate
ORDER BY e.ApproveDate DESC;

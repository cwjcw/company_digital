-- 科加 T+ 工艺：只读元数据探查参考。此文件供查看/复制，运行前仍须确认连接科加账套。
-- 实际脚本复用 KDOS Source.query()，SQL 无终止分号（只读守卫）。

-- 1. 当前数据库
SELECT DB_NAME() AS source_database, SYSTEM_USER AS login_name

-- 2. 工艺/BOM/存货相关候选表
SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
  AND (TABLE_NAME LIKE '%Routing%'
    OR TABLE_NAME LIKE '%Process%'
    OR TABLE_NAME LIKE '%BOM%'
    OR TABLE_NAME LIKE '%Inventory%'
    OR TABLE_NAME LIKE '%Manufactur%')
ORDER BY TABLE_SCHEMA, TABLE_NAME

-- 3. 字段结构（表名先按实际结果调整）
SELECT TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('AA_ProductProcess','AA_Routing','AA_Routing_b','AA_BOM','AA_BOMChild','AA_Inventory')
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION

-- 4. 外键结构（T+ 不一定对所有业务关联设置物理外键）
SELECT fk.name AS fk_name,
       sp.name AS parent_schema, tp.name AS parent_table, cp.name AS parent_column,
       sr.name AS ref_schema, tr.name AS ref_table, cr.name AS ref_column
FROM sys.foreign_keys AS fk
JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.tables AS tp ON tp.object_id = fk.parent_object_id
JOIN sys.schemas AS sp ON sp.schema_id = tp.schema_id
JOIN sys.columns AS cp ON cp.object_id = tp.object_id AND cp.column_id = fkc.parent_column_id
JOIN sys.tables AS tr ON tr.object_id = fk.referenced_object_id
JOIN sys.schemas AS sr ON sr.schema_id = tr.schema_id
JOIN sys.columns AS cr ON cr.object_id = tr.object_id AND cr.column_id = fkc.referenced_column_id
WHERE tp.name LIKE '%Routing%' OR tr.name LIKE '%Routing%'
   OR tp.name LIKE '%BOM%' OR tr.name LIKE '%BOM%'
   OR tp.name LIKE '%Process%' OR tr.name LIKE '%Process%'
ORDER BY parent_table, ref_table, fk.name

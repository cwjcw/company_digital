BEGIN;

TRUNCATE TABLE
  daily_process_progress, item_process_progress, outsourcing_details, order_items,
  orders, plan_periods, sales_orders, finished_goods_inbound
RESTART IDENTITY CASCADE;

CREATE TEMP TABLE demo_seed ON COMMIT DROP AS
SELECT
  series AS sequence,
  'DEMO-SO-2026-' || lpad(series::text, 4, '0') AS order_number,
  'DEMO-ITEM-' || lpad(series::text, 3, '0') AS item_number,
  'DEMO-C' || lpad((((series - 1) % 5) + 1)::text, 3, '0') AS customer_code,
  ('演示客户' || (ARRAY['A','B','C','D','E'])[((series - 1) % 5) + 1])::varchar AS customer_name,
  ('演示业务员' || (ARRAY['甲','乙','丙','丁'])[((series - 1) % 4) + 1])::varchar AS salesperson,
  ('事业' || (ARRAY['一','二','三','四'])[((series - 1) % 4) + 1] || '部')::varchar AS division,
  (ARRAY['演示升降桌架','演示会议桌脚','演示屏风支架','演示储物柜架','演示办公椅架'])[((series - 1) % 5) + 1]::varchar AS item_name,
  (80 + series * 10)::numeric(18,4) AS quantity,
  (120 + series * 8)::numeric(18,6) AS unit_price,
  (8 + floor((series - 1) / 3))::integer AS plan_month,
  make_date(2026, (8 + floor((series - 1) / 3))::integer, 3 + ((series - 1) % 10)) AS order_date,
  make_date(2026, (8 + floor((series - 1) / 3))::integer, 20 + ((series - 1) % 7)) AS delivery_date,
  (ARRAY[0.15,0.35,0.55,0.75,1.00])[((series - 1) % 5) + 1]::numeric AS completion_ratio
FROM generate_series(1, 15) AS series;

INSERT INTO suppliers(code, name, remark, enabled, updated_by)
VALUES ('DEMO-SUPPLIER', '演示外协供应商', '[DEMO] 客户演示专用', true, 'demo-seed')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, remark = EXCLUDED.remark,
  enabled = true, updated_at = now(), updated_by = 'demo-seed';

INSERT INTO plan_periods(year, month, status, updated_by)
SELECT 2026, month, 'active', 'demo-seed'
FROM generate_series(8, 12) AS month;

INSERT INTO orders(
  order_number, order_date, customer_due_date, review_due_date, exception_due_date,
  exception_delivery_method, customer, salesperson, order_type, order_amount,
  delivery_score, quality_score, source_system, source_database, source_account_name,
  source_total_quantity, source_active, division, version, updated_by
)
SELECT
  order_number, order_date, delivery_date, delivery_date - 2,
  CASE WHEN sequence % 6 = 0 THEN delivery_date + 2 END,
  CASE WHEN sequence % 6 = 0 THEN '演示加急配送' END,
  customer_name, salesperson, '演示常规订单', quantity * unit_price,
  CASE WHEN completion_ratio = 1 THEN 98 ELSE NULL END,
  CASE WHEN completion_ratio = 1 THEN 97 ELSE NULL END,
  'DEMO', 'demo_database', '演示账套', quantity, true, division, 1, 'demo-seed'
FROM demo_seed;

INSERT INTO order_items(
  order_id, period_id, item_number, relation_key, item_name, customer_due_date,
  review_due_date, exception_due_date, exception_delivery_method, customer, division,
  container_date, model_age, product_attribute, surface_nature, special_item,
  production_quantity, historical_inbound_quantity, today_inbound_quantity,
  handling_method, plan_page, order_exception, inspection, inspection_quantity,
  remark, order_weeks, source_month, unit_price, active, version, updated_by
)
SELECT
  orders.id, periods.id, seed.item_number, seed.order_number || '-' || seed.item_number,
  seed.item_name, seed.delivery_date, seed.delivery_date - 2,
  CASE WHEN seed.sequence % 6 = 0 THEN seed.delivery_date + 2 END,
  CASE WHEN seed.sequence % 6 = 0 THEN '演示加急配送' END,
  seed.customer_name, seed.division, seed.delivery_date - 5,
  CASE WHEN seed.sequence % 2 = 0 THEN '新款' ELSE '常规' END,
  CASE WHEN seed.sequence % 2 = 0 THEN '五金' ELSE '综合' END,
  CASE WHEN seed.sequence % 3 = 0 THEN '喷涂' ELSE '常规' END,
  CASE WHEN seed.sequence % 7 = 0 THEN '演示特殊件' END,
  seed.quantity,
  round(seed.quantity * greatest(seed.completion_ratio - 0.10, 0), 4),
  round(seed.quantity * least(seed.completion_ratio, 0.10), 4),
  '正常排产', seed.sequence, NULL, '抽检', round(seed.quantity * 0.10, 4),
  '[DEMO] 仅供客户测试', 2, seed.plan_month, seed.unit_price, true, 1, 'demo-seed'
FROM demo_seed seed
JOIN orders ON orders.order_number = seed.order_number
JOIN plan_periods periods ON periods.year = 2026 AND periods.month = seed.plan_month;

INSERT INTO item_process_progress(
  order_item_id, process_definition_id, required_days, due_date, quantity, status, exception, version, updated_by
)
SELECT
  item.id, definition.id, 2, item.review_due_date - (5 - definition.rank)::integer,
  round(item.production_quantity * least(seed.completion_ratio + definition.rank * 0.05, 1), 2),
  CASE WHEN seed.completion_ratio + definition.rank * 0.05 >= 1 THEN '已完成' ELSE '进行中' END,
  CASE WHEN seed.sequence % 8 = 0 AND definition.rank = 2 THEN '[DEMO] 物料预计晚到一天' END,
  1, 'demo-seed'
FROM order_items item
JOIN orders orders ON orders.id = item.order_id
JOIN demo_seed seed ON seed.order_number = orders.order_number
CROSS JOIN LATERAL (
  SELECT process.id, row_number() OVER (ORDER BY process.sort_order)::integer AS rank
  FROM process_definitions process WHERE process.enabled = true ORDER BY process.sort_order LIMIT 4
) definition;

INSERT INTO daily_process_progress(order_item_id, process_definition_id, work_date, quantity, updated_by)
SELECT item.id, definition.id, DATE '2026-08-22', (5 + seed.sequence + definition.rank)::numeric, 'demo-seed'
FROM order_items item
JOIN orders orders ON orders.id = item.order_id
JOIN demo_seed seed ON seed.order_number = orders.order_number AND seed.completion_ratio < 1
CROSS JOIN LATERAL (
  SELECT process.id, row_number() OVER (ORDER BY process.sort_order)::integer AS rank
  FROM process_definitions process WHERE process.enabled = true ORDER BY process.sort_order LIMIT 2
) definition;

INSERT INTO outsourcing_details(order_item_id, supplier, method, due_date, exception_due_date, updated_by)
SELECT item.id, '演示外协供应商', '演示委外加工', item.review_due_date - 1,
  CASE WHEN seed.sequence % 6 = 0 THEN item.review_due_date + 1 END, 'demo-seed'
FROM order_items item
JOIN orders orders ON orders.id = item.order_id
JOIN demo_seed seed ON seed.order_number = orders.order_number
WHERE seed.sequence % 3 = 0;

INSERT INTO sales_orders(
  document_date, order_date, order_number, document_name, close_status, customer_code,
  ship_to_customer_code, invoice_customer_code, employee_name, tax_included,
  currency_code, exchange_rate, sequence_number, item_number, item_name, specification,
  unit_name, business_quantity, price_quantity, price, rmb_price,
  rmb_tax_included_amount, delivered_business_quantity, planned_delivery_date,
  tax_rate, amount_excluding_tax_bc, tax_bc, creator_user_id, creator_user_name,
  admin_unit_name, owner_department, owner_employee, owner_division,
  review_due_date, quantity, remark, updated_by
)
SELECT
  order_date, order_date, order_number, '演示销售订单',
  CASE WHEN completion_ratio = 1 THEN '已结案' ELSE '未结案' END,
  customer_code, customer_code || '-SHIP', customer_code || '-INV', salesperson,
  '含税', 'CNY', 1, sequence, item_number, item_name, 'DEMO-' || lpad(sequence::text, 3, '0'),
  '件', quantity, quantity, unit_price, unit_price, round(unit_price * 1.13, 6),
  round(quantity * completion_ratio, 4), delivery_date, 13,
  round(quantity * unit_price / 1.13, 6), round(quantity * unit_price - quantity * unit_price / 1.13, 6),
  'DEMO-U001', '演示制单员', '演示管理单位', division || '销售课', salesperson, division,
  delivery_date, quantity, '[DEMO] 虚构演示订单', 'demo-seed'
FROM demo_seed;

INSERT INTO finished_goods_inbound(
  category_number, document_number, document_full_name, document_date, inbound_date,
  line_number, work_order_number, sales_order_number, inventory_code, quick_code,
  inventory_name, specification, received_quantity, unit, category, created_time,
  business_type, warehouse_code, warehouse, inbound_category, workshop_code,
  workshop, handler_code, handler, remark, creator, auditor, relation_info,
  unit_price, total_amount, voucher_word, updated_by
)
SELECT
  'DEMO-FG', 'DEMO-IN-2026-' || lpad(entry::text, 4, '0'), '演示成品入库单',
  DATE '2026-08-01' + ((entry - 1) % 22), DATE '2026-08-01' + ((entry - 1) % 22),
  ((entry - 1) % 2) + 1, 'DEMO-WO-' || lpad(seed.sequence::text, 4, '0'), seed.order_number,
  seed.item_number, 'D' || lpad(seed.sequence::text, 3, '0'), seed.item_name,
  'DEMO-' || lpad(seed.sequence::text, 3, '0'), round(seed.quantity * seed.completion_ratio / 2, 4),
  '件', '演示成品', now(), '演示生产入库', 'DEMO-WH', '演示成品仓',
  '正常入库', 'DEMO-WS', seed.division || '车间', 'DEMO-H01', '演示经手人',
  '[DEMO] 虚构入库记录', '演示制单员', '演示审核员',
  'DEMO-WO-' || lpad(seed.sequence::text, 4, '0') || '|' || (((entry - 1) % 2) + 1),
  seed.unit_price, round(seed.quantity * seed.completion_ratio / 2 * seed.unit_price, 6),
  'DEMO-' || lpad(entry::text, 4, '0'), 'demo-seed'
FROM generate_series(1, 30) entry
JOIN demo_seed seed ON seed.sequence = ceil(entry / 2.0)::integer;

INSERT INTO audit_logs(actor_name, resource, action, before_json, after_json, request_id, source, updated_by)
VALUES ('system', 'demo-data', 'replace-business-data',
  jsonb_build_object('backup','backup/20260822-1640-before-demo-legacy.dump'),
  jsonb_build_object('orders',15,'salesOrders',15,'inboundRows',30,'demoOnly',true),
  'demo-seed-20260822', 'import', 'demo-seed');

COMMIT;

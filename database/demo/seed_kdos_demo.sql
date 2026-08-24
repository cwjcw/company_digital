BEGIN;

TRUNCATE TABLE
  marketing.order_schedules, marketing.business_customer_mappings,
  planning.weekly_plan_items, planning.work_reports, planning.daily_progress,
  planning.process_progress, planning.plan_changes, planning.plan_snapshots,
  planning.plan_items, planning.sales_order_lines, planning.sales_orders,
  planning.plan_versions, planning.plan_periods
CASCADE;

CREATE TEMP TABLE demo_seed ON COMMIT DROP AS
SELECT
  series AS sequence,
  'DEMO-SO-2026-' || lpad(series::text, 4, '0') AS order_number,
  'DEMO-ITEM-' || lpad(series::text, 3, '0') AS item_number,
  'DEMO-C' || lpad((((series - 1) % 5) + 1)::text, 3, '0') AS customer_code,
  ('演示客户' || (ARRAY['A','B','C','D','E'])[((series - 1) % 5) + 1])::varchar AS customer_name,
  ('事业' || (ARRAY['一','二','三','四'])[((series - 1) % 4) + 1] || '部')::varchar AS production_unit,
  (ARRAY['演示升降桌架','演示会议桌脚','演示屏风支架','演示储物柜架','演示办公椅架'])[((series - 1) % 5) + 1]::varchar AS item_name,
  (80 + series * 10)::numeric(18,4) AS quantity,
  (120 + series * 8)::numeric(18,6) AS unit_price,
  (8 + floor((series - 1) / 3))::integer AS plan_month,
  make_date(2026, (8 + floor((series - 1) / 3))::integer, 3 + ((series - 1) % 10)) AS order_date,
  make_date(2026, (8 + floor((series - 1) / 3))::integer, 20 + ((series - 1) % 7)) AS delivery_date,
  (DATE '2026-08-16' + ((series - 1) * 2)) AS schedule_due_date,
  (ARRAY[0.15,0.35,0.55,0.75,1.00])[((series - 1) % 5) + 1]::numeric AS completion_ratio
FROM generate_series(1, 15) AS series;

INSERT INTO planning.plan_periods(tenant_id, year, month, status)
SELECT tenant.id, 2026, month, 'OPEN'
FROM iam.tenants tenant CROSS JOIN generate_series(8, 12) AS month
WHERE tenant.code = 'KAINAN';

INSERT INTO planning.plan_versions(tenant_id, period_id, version_number, name, status, published_at)
SELECT period.tenant_id, period.id, 1, period.year || '年' || period.month || '月演示计划', 'PUBLISHED', now()
FROM planning.plan_periods period;

UPDATE planning.plan_periods period SET current_version_id = version.id
FROM planning.plan_versions version WHERE version.period_id = period.id;

INSERT INTO planning.sales_orders(
  tenant_id, order_number, customer_code, customer_name, order_date,
  source_system, source_key, source_updated_at, enabled
)
SELECT tenant.id, seed.order_number, seed.customer_code, seed.customer_name, seed.order_date,
  'DEMO', 'DEMO:' || seed.order_number, now(), true
FROM demo_seed seed CROSS JOIN iam.tenants tenant WHERE tenant.code = 'KAINAN';

INSERT INTO planning.sales_order_lines(
  tenant_id, sales_order_id, line_number, item_number, item_name,
  specification, order_quantity, delivery_date, source_payload
)
SELECT orders.tenant_id, orders.id, seed.sequence, seed.item_number, seed.item_name,
  'DEMO-' || lpad(seed.sequence::text, 3, '0'), seed.quantity, seed.delivery_date,
  jsonb_build_object('demo',true,'source','fictional')
FROM demo_seed seed JOIN planning.sales_orders orders ON orders.order_number = seed.order_number;

INSERT INTO planning.plan_items(
  tenant_id, plan_version_id, sales_order_line_id, order_number, item_number,
  customer_code, customer_name, item_name, specification, order_quantity,
  production_quantity, historical_inbound_quantity, current_inbound_quantity,
  unit_price, delivery_date, priority, sequence, status, exception, remark,
  image_refs, legacy_data, version
)
SELECT
  period.tenant_id, version.id, line.id, seed.order_number, seed.item_number,
  seed.customer_code, seed.customer_name, seed.item_name,
  'DEMO-' || lpad(seed.sequence::text, 3, '0'), seed.quantity, seed.quantity,
  round(seed.quantity * greatest(seed.completion_ratio - 0.10, 0), 4),
  round(seed.quantity * least(seed.completion_ratio, 0.10), 4),
  seed.unit_price, seed.delivery_date, 10 + seed.sequence, seed.sequence,
  CASE WHEN seed.completion_ratio = 1 THEN 'COMPLETED' ELSE 'PENDING' END,
  CASE WHEN seed.sequence % 8 = 0 THEN '[DEMO] 物料预计晚到一天' END,
  '[DEMO] 虚构主计划数据', '[]'::jsonb,
  jsonb_build_object('division',seed.production_unit,'demo',true), 1
FROM demo_seed seed
JOIN planning.plan_periods period ON period.year = 2026 AND period.month = seed.plan_month
JOIN planning.plan_versions version ON version.period_id = period.id
JOIN planning.sales_orders orders ON orders.tenant_id = period.tenant_id AND orders.order_number = seed.order_number
JOIN planning.sales_order_lines line ON line.sales_order_id = orders.id AND line.item_number = seed.item_number;

INSERT INTO planning.process_progress(
  tenant_id, plan_item_id, process_definition_id, required_days, planned_date,
  actual_date, planned_quantity, completed_quantity, status, exception, version
)
SELECT
  item.tenant_id, item.id, definition.id, 2, item.delivery_date - (5 - definition.rank)::integer,
  CASE WHEN seed.completion_ratio + definition.rank * 0.05 >= 1 THEN item.delivery_date - (5 - definition.rank)::integer END,
  item.production_quantity,
  round(item.production_quantity * least(seed.completion_ratio + definition.rank * 0.05, 1), 4),
  CASE WHEN seed.completion_ratio + definition.rank * 0.05 >= 1 THEN 'COMPLETED' ELSE 'IN_PROGRESS' END,
  CASE WHEN seed.sequence % 8 = 0 AND definition.rank = 2 THEN '[DEMO] 演示工序异常' END, 1
FROM planning.plan_items item
JOIN demo_seed seed ON seed.order_number = item.order_number
CROSS JOIN LATERAL (
  SELECT process.id, row_number() OVER (ORDER BY process.sequence)::integer AS rank
  FROM planning.process_definitions process
  WHERE process.tenant_id = item.tenant_id AND process.enabled = true
  ORDER BY process.sequence LIMIT 4
) definition;

INSERT INTO planning.daily_progress(
  tenant_id, plan_item_id, process_definition_id, work_date, completed_quantity, version
)
SELECT item.tenant_id, item.id, definition.id, DATE '2026-08-22',
  (5 + seed.sequence + definition.rank)::numeric, 1
FROM planning.plan_items item
JOIN demo_seed seed ON seed.order_number = item.order_number AND seed.completion_ratio < 1
CROSS JOIN LATERAL (
  SELECT process.id, row_number() OVER (ORDER BY process.sequence)::integer AS rank
  FROM planning.process_definitions process
  WHERE process.tenant_id = item.tenant_id AND process.enabled = true
  ORDER BY process.sequence LIMIT 2
) definition;

INSERT INTO marketing.business_customer_mappings(
  tenant_id, department, section, salesperson, customer_codes, version
)
SELECT tenant.id, mapping.department, mapping.section, mapping.salesperson, mapping.customer_codes, 1
FROM iam.tenants tenant CROSS JOIN (VALUES
  ('演示营销一部','演示一课','演示业务员甲','DEMO-C001|DEMO-C002'),
  ('演示营销一部','演示二课','演示业务员乙','DEMO-C003'),
  ('演示营销二部','演示一课','演示业务员丙','DEMO-C004'),
  ('演示营销二部','演示二课','演示业务员丁','DEMO-C005')
) mapping(department,section,salesperson,customer_codes)
WHERE tenant.code = 'KAINAN';

INSERT INTO marketing.order_schedules(
  tenant_id, customer_code, order_number, item_number, item_name,
  customer_due_date, order_total_quantity, production_unit, completion_ratio,
  source_plan_item_id, last_synced_at, version
)
SELECT item.tenant_id, item.customer_code, item.order_number, item.item_number, item.item_name,
  seed.schedule_due_date, item.order_quantity, seed.production_unit,
  round(seed.completion_ratio * 100, 4), item.id, now(), 1
FROM planning.plan_items item JOIN demo_seed seed ON seed.order_number = item.order_number;

INSERT INTO planning.weekly_plan_items(
  tenant_id, weekly_plan_period_id, source_order_schedule_id, customer_code,
  order_number, item_number, item_name, order_total_quantity, production_unit,
  completion_ratio, customer_due_date, review_due_date, version
)
SELECT schedule.tenant_id, period.id, schedule.id, schedule.customer_code,
  schedule.order_number, schedule.item_number, schedule.item_name,
  schedule.order_total_quantity, schedule.production_unit, schedule.completion_ratio,
  schedule.customer_due_date, item.delivery_date, 1
FROM marketing.order_schedules schedule
JOIN planning.weekly_plan_periods period ON period.tenant_id = schedule.tenant_id
  AND schedule.customer_due_date BETWEEN period.start_date AND period.end_date
JOIN planning.plan_items item ON item.id = schedule.source_plan_item_id
WHERE schedule.completion_ratio < 100;

INSERT INTO planning.work_reports(
  tenant_id, work_date, source_plan_item_id, customer, order_number,
  item_number, item_name, required_quantity, reported_quantity, version
)
SELECT item.tenant_id, DATE '2026-08-22', item.id, item.customer_name,
  item.order_number, item.item_number, item.item_name, item.order_quantity,
  round(item.order_quantity * 0.08, 4), 1
FROM planning.plan_items item
JOIN planning.plan_versions version ON version.id = item.plan_version_id
JOIN planning.plan_periods period ON period.id = version.period_id
WHERE period.year = 2026 AND period.month = 8;

INSERT INTO planning.plan_snapshots(tenant_id, version_id, snapshot_number, payload)
SELECT version.tenant_id, version.id, 1,
  jsonb_build_object('demo',true,'period',period.year || '-' || lpad(period.month::text,2,'0'),'rowCount',3)
FROM planning.plan_versions version JOIN planning.plan_periods period ON period.id = version.period_id;

INSERT INTO planning.plan_changes(tenant_id, version_id, change_type, after, reason, source)
SELECT version.tenant_id, version.id, 'DEMO_SEED', jsonb_build_object('demo',true),
  '为客户演示环境生成虚构数据', 'SYSTEM_JOB'
FROM planning.plan_versions version;

INSERT INTO audit.audit_logs(
  tenant_id, action, resource_type, after, reason, source, request_id
)
SELECT tenant.id, 'demo.business_data.replaced', 'DemoDataSet',
  jsonb_build_object('planItems',15,'orderSchedules',15,'workReports',3,'demoOnly',true),
  '已备份真实数据并替换为虚构演示数据', 'SYSTEM_JOB', 'demo-seed-20260822'
FROM iam.tenants tenant WHERE tenant.code = 'KAINAN';

COMMIT;

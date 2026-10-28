BEGIN;
CREATE TABLE marketing.logistics_shipments (
 id uuid PRIMARY KEY DEFAULT uuidv7(),
 tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
 logistics_number text NOT NULL,
 customer_code text,
 owner_user_id uuid,
 shipment_date date,
 container_type text,
 container_number text,
 port_fee numeric,
 customs_fee numeric,
 inspection_fee numeric,
 trucking_fee numeric,
 fumigation_fee numeric,
 exception_fee numeric,
 remark text,
 total_fee numeric GENERATED ALWAYS AS (CASE WHEN port_fee IS NULL AND customs_fee IS NULL AND inspection_fee IS NULL AND trucking_fee IS NULL AND fumigation_fee IS NULL AND exception_fee IS NULL THEN NULL ELSE COALESCE(port_fee,0)+COALESCE(customs_fee,0)+COALESCE(inspection_fee,0)+COALESCE(trucking_fee,0)+COALESCE(fumigation_fee,0)+COALESCE(exception_fee,0) END) STORED,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,logistics_number), CHECK(length(btrim(logistics_number))>0)
);
CREATE TABLE marketing.logistics_details (
 id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES iam.tenants(id), shipment_id uuid NOT NULL,
 sequence text,
 style_number text,
 item_name text,
 material text,
 quantity numeric,
 packing_quantity numeric,
 net_weight numeric,
 gross_weight numeric,
 order_number text,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
 FOREIGN KEY(tenant_id,shipment_id) REFERENCES marketing.logistics_shipments(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX logistics_details_shipment_idx ON marketing.logistics_details(tenant_id,shipment_id);
CREATE INDEX logistics_details_order_idx ON marketing.logistics_details(tenant_id,order_number);
CREATE TABLE marketing.logistics_imports (id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES iam.tenants(id), command_key text NOT NULL, file_hash text NOT NULL, result jsonb NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1, UNIQUE(tenant_id,command_key), UNIQUE(tenant_id,file_hash));
ALTER TABLE marketing.logistics_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.logistics_shipments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing.logistics_shipments USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE marketing.logistics_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.logistics_details FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing.logistics_details USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE marketing.logistics_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing.logistics_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing.logistics_imports USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
-- One editable row per style; shared costs are stored solely on the shipment.
CREATE VIEW marketing.logistics_ledger_rows WITH (security_invoker=true) AS
SELECT d.id, s.tenant_id, s.id shipment_id, s.version,
s.logistics_number,
s.customer_code,
s.owner_user_id,
s.shipment_date,
s.container_type,
s.container_number,
s.port_fee,
s.customs_fee,
s.inspection_fee,
s.trucking_fee,
s.fumigation_fee,
s.exception_fee,
s.remark, s.total_fee,
d.sequence,
d.style_number,
d.item_name,
d.material,
d.quantity,
d.packing_quantity,
d.net_weight,
d.gross_weight,
d.order_number,
s.created_at, s.created_by, s.updated_at, s.updated_by,
(SELECT string_agg(DISTINCT x.order_number, '、' ORDER BY x.order_number) FROM marketing.logistics_details x WHERE x.tenant_id=s.tenant_id AND x.shipment_id=s.id AND x.order_number IS NOT NULL) order_numbers
FROM marketing.logistics_shipments s JOIN marketing.logistics_details d ON d.tenant_id=s.tenant_id AND d.shipment_id=s.id;
COMMIT;

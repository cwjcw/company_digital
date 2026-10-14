import type { MigrationInterface, QueryRunner } from "typeorm";

/** Also used by the private, read-only preflight preview. No business IDs are embedded. */
export const allocationQuantityRepairCandidatesSql = `WITH proven AS (
  SELECT m.id,m.tenant_id,m.version,m.allocated_quantity AS before_quantity,m.unallocated_quantity AS after_quantity,
    a.id AS import_audit_id,c.id AS confirmation_audit_id,c.after_json->>'fileHash' AS file_hash,
    count(*) OVER(PARTITION BY m.id) AS evidence_matches
  FROM mps_order_allocations m
  JOIN audit_logs a ON a.record_id=m.id::text AND a.action='mps-order-allocations.import_created'
    AND a.actor_id=m.created_by AND (a.tenant_id=m.tenant_id OR a.tenant_id IS NULL)
  JOIN audit_logs c ON c.action='mps-order-allocations.import_confirmed' AND c.actor_id=a.actor_id
    AND c.created_at=a.created_at AND c.request_id=a.request_id AND (c.tenant_id=m.tenant_id OR c.tenant_id IS NULL)
  WHERE m.version=1 AND m.allocated_quantity=0 AND m.unallocated_quantity>0
    AND (a.after_json->>'allocatedQuantity')::numeric=0
    AND (a.after_json->>'unallocatedQuantity')::numeric=m.unallocated_quantity
    AND c.after_json->>'fileHash' ~ '^[0-9a-f]{64}(:[0-9a-f-]{36})?$'
    AND NOT EXISTS(SELECT 1 FROM audit_logs later WHERE later.record_id=m.id::text
      AND later.created_at>a.created_at AND later.action LIKE 'mps-order-allocations.%')
) SELECT * FROM proven WHERE evidence_matches=1`;

const systemId="0199e000-0000-7000-8000-000000000001";
export class AllocationAppendBatches1722920093000 implements MigrationInterface {
  name="AllocationAppendBatches1722920093000";
  async up(r:QueryRunner) {
    await r.query("LOCK TABLE mps_order_allocations,mps_monthly_plans IN ACCESS EXCLUSIVE MODE");
    const candidates=await r.query(allocationQuantityRepairCandidatesSql);
    const verified=new Map(candidates.map((row:Record<string,unknown>)=>[row.id,row]));
    const retired=await r.query("SELECT id,tenant_id,version,allocated_quantity,unallocated_quantity FROM mps_order_allocations WHERE unallocated_quantity IS NOT NULL FOR UPDATE");
    for(const row of retired) {
      const proof=verified.get(row.id) as Record<string,unknown>|undefined;
      if(proof)await r.query("UPDATE mps_order_allocations SET allocated_quantity=$2::numeric,version=version+1,updated_at=now(),updated_by=$3::uuid WHERE id=$1::uuid",[row.id,row.unallocated_quantity,systemId]);
      await r.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,'系统迁移','mps-order-allocations',$3,'mps-order-allocations.legacy_quantity_retired',$4::jsonb,$5::jsonb,'migration:AllocationAppendBatches1722920093000','api',$2::uuid,$2::uuid)`,[
        row.tenant_id,systemId,row.id,
        JSON.stringify({allocatedQuantity:row.allocated_quantity,retiredUnallocatedQuantity:row.unallocated_quantity,version:row.version}),
        JSON.stringify({allocatedQuantity:proof?row.unallocated_quantity:row.allocated_quantity,verifiedCorrection:Boolean(proof),version:Number(row.version)+(proof?1:0),importAuditId:proof?.import_audit_id,confirmationAuditId:proof?.confirmation_audit_id})]);
    }
    // Retain retired grants for conditional schema rollback, without leaving an active field contract.
    await r.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,request_id,source,created_by,updated_by)
      SELECT 'KAINAN',$1::uuid,'系统迁移','permissions:mps-order-allocations',id::text,'mps-order-allocations.quantity_permissions_retired',to_jsonb(p),'migration:AllocationAppendBatches1722920093000','api',$1::uuid,$1::uuid
      FROM permissions p WHERE resource='mps-order-allocations' AND field_key='unallocatedQuantity'`,[systemId]);
    await r.query("DELETE FROM permissions WHERE resource='mps-order-allocations' AND field_key='unallocatedQuantity'");
    await r.query(`CREATE TABLE mps_allocation_import_batches(
      id uuid PRIMARY KEY,tenant_id varchar(64) NOT NULL,file_hash varchar(64) NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
      source_worksheet varchar(128) NOT NULL CHECK(btrim(source_worksheet)<>''),row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 50000),
      imported_at timestamptz NOT NULL DEFAULT now(),imported_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      UNIQUE(tenant_id,id));
      ALTER TABLE mps_allocation_import_batches ENABLE ROW LEVEL SECURITY;
      ALTER TABLE mps_allocation_import_batches FORCE ROW LEVEL SECURITY;
      CREATE POLICY mps_allocation_import_batches_tenant ON mps_allocation_import_batches
        USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE mps_order_allocations ADD COLUMN import_batch_id uuid,ADD COLUMN source_worksheet varchar(128),
        ADD COLUMN source_row_number integer,ADD COLUMN imported_at timestamptz,ADD COLUMN imported_by uuid REFERENCES users(id) ON DELETE RESTRICT;
      ALTER TABLE mps_order_allocations ADD CONSTRAINT fk_mps_allocation_batch FOREIGN KEY(tenant_id,import_batch_id)
        REFERENCES mps_allocation_import_batches(tenant_id,id) ON DELETE RESTRICT;
      ALTER TABLE mps_order_allocations ADD CONSTRAINT ck_mps_allocation_lineage CHECK(
        (import_batch_id IS NULL AND source_worksheet IS NULL AND source_row_number IS NULL AND imported_at IS NULL AND imported_by IS NULL) OR
        (import_batch_id IS NOT NULL AND source_worksheet IS NOT NULL AND source_row_number>=2 AND source_row_number IS NOT NULL AND imported_at IS NOT NULL AND imported_by IS NOT NULL));
      CREATE UNIQUE INDEX uq_mps_allocation_batch_row ON mps_order_allocations(tenant_id,import_batch_id,source_row_number) WHERE import_batch_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_mps_allocation_tenant_id ON mps_order_allocations(tenant_id,id);
      ALTER TABLE mps_monthly_plans ADD COLUMN allocation_id uuid;
      UPDATE mps_monthly_plans p SET allocation_id=a.id FROM mps_order_allocations a
        WHERE a.tenant_id=p.tenant_id AND a.order_number=p.order_number AND a.item_code=p.item_code;
      ALTER TABLE mps_monthly_plans ALTER COLUMN allocation_id SET NOT NULL;
      ALTER TABLE mps_monthly_plans DROP CONSTRAINT fk_mps_monthly_allocation_business;
      ALTER TABLE mps_monthly_plans ADD CONSTRAINT fk_mps_monthly_allocation_id FOREIGN KEY(tenant_id,allocation_id)
        REFERENCES mps_order_allocations(tenant_id,id) ON DELETE RESTRICT;
      ALTER TABLE mps_order_allocations DROP CONSTRAINT uq_mps_order_allocation;
      DROP INDEX mps_alloc_order_sequence;
      CREATE INDEX idx_mps_allocation_business ON mps_order_allocations(tenant_id,order_number,item_code);
      ALTER TABLE mps_order_allocations DROP COLUMN unallocated_quantity;`);
  }
  async down(r:QueryRunner) {
    await r.query("LOCK TABLE mps_order_allocations,mps_monthly_plans,mps_allocation_import_batches IN ACCESS EXCLUSIVE MODE");
    const [guard]=await r.query(`SELECT EXISTS(SELECT 1 FROM mps_allocation_import_batches) OR EXISTS(
      SELECT 1 FROM mps_order_allocations GROUP BY tenant_id,order_number,item_code HAVING count(*)>1) OR EXISTS(
      SELECT 1 FROM mps_order_allocations WHERE order_sequence IS NOT NULL GROUP BY tenant_id,order_number,order_sequence HAVING count(*)>1) AS unsafe`);
    if(guard.unsafe)throw new Error("追加批次或多行身份已生效，禁止退回旧唯一键；保留数据并执行兼容前向修复。");
    // Verified business corrections stay corrected. Schema rollback never restores a proven wrong quantity.
    await r.query(`ALTER TABLE mps_order_allocations ADD COLUMN unallocated_quantity numeric(20,4);
      UPDATE mps_order_allocations m SET unallocated_quantity=(a.before_json->>'retiredUnallocatedQuantity')::numeric
      FROM (SELECT DISTINCT ON(record_id) record_id,before_json FROM audit_logs
        WHERE action='mps-order-allocations.legacy_quantity_retired' ORDER BY record_id,created_at DESC,id DESC) a WHERE m.id::text=a.record_id;
      ALTER TABLE mps_monthly_plans DROP CONSTRAINT fk_mps_monthly_allocation_id;
      DROP INDEX idx_mps_allocation_business;
      ALTER TABLE mps_order_allocations ADD CONSTRAINT uq_mps_order_allocation UNIQUE(tenant_id,order_number,item_code);
      CREATE UNIQUE INDEX mps_alloc_order_sequence ON mps_order_allocations(tenant_id,order_number,order_sequence) WHERE order_sequence IS NOT NULL;
      ALTER TABLE mps_monthly_plans ADD CONSTRAINT fk_mps_monthly_allocation_business FOREIGN KEY(tenant_id,order_number,item_code)
        REFERENCES mps_order_allocations(tenant_id,order_number,item_code) ON UPDATE CASCADE ON DELETE RESTRICT;
      ALTER TABLE mps_monthly_plans DROP COLUMN allocation_id;
      ALTER TABLE mps_order_allocations DROP CONSTRAINT fk_mps_allocation_batch,DROP CONSTRAINT ck_mps_allocation_lineage,
        DROP COLUMN import_batch_id,DROP COLUMN source_worksheet,DROP COLUMN source_row_number,DROP COLUMN imported_at,DROP COLUMN imported_by;
      DROP INDEX uq_mps_allocation_tenant_id;
      DROP TABLE mps_allocation_import_batches;`);
    await r.query(`INSERT INTO permissions SELECT (jsonb_populate_record(NULL::permissions,a.before_json)).* FROM (
      SELECT DISTINCT ON(record_id) before_json FROM audit_logs WHERE action='mps-order-allocations.quantity_permissions_retired'
      ORDER BY record_id,created_at DESC,id DESC) a
      WHERE EXISTS(SELECT 1 FROM roles WHERE id=(a.before_json->>'role_id')::uuid) ON CONFLICT DO NOTHING`);
  }
}

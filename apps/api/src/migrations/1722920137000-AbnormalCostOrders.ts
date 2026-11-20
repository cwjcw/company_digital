import type { MigrationInterface, QueryRunner } from 'typeorm';
import { abnormalExpenseCategorySeeds } from '@kdos/contracts';
export class AbnormalCostOrders1722920137000 implements MigrationInterface {
  name='AbnormalCostOrders1722920137000';
  async up(r:QueryRunner){
    const audit=`created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_by varchar NOT NULL DEFAULT 'abnormal-order-sync',updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0)`;
    await r.query(`CREATE TABLE abnormal_cost_order_items(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,order_no varchar(100) NOT NULL CHECK(btrim(order_no)<>''),item_code varchar(128) NOT NULL CHECK(btrim(item_code)<>''),item_name varchar(500),required_quantity numeric(38,14) NOT NULL,order_date date NOT NULL CHECK(order_date>='2026-01-01'),customer_due_date date,source varchar(32) NOT NULL CHECK(source IN('e10-main','tplus-kainan','tplus-kejia','SYSTEM_FIXED')),source_line_ids jsonb NOT NULL DEFAULT '[]',conflicts jsonb NOT NULL DEFAULT '{}',sync_batch_id uuid,last_synced_at timestamptz,is_active boolean NOT NULL DEFAULT true,deleted_at timestamptz,${audit},UNIQUE(tenant_id,id),UNIQUE(tenant_id,order_no,item_code),CHECK(source<>'SYSTEM_FIXED' OR (order_no='虚拟订单' AND item_code='虚拟品号' AND item_name='虚拟品名' AND required_quantity=0 AND order_date='2026-01-01' AND customer_due_date='2026-01-01' AND is_active AND deleted_at IS NULL)));
      CREATE INDEX ix_abnormal_order_choices ON abnormal_cost_order_items(tenant_id,order_no,item_code) WHERE is_active AND deleted_at IS NULL;
      CREATE TABLE abnormal_expense_categories(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,major_category varchar(100) NOT NULL CHECK(btrim(major_category)<>''),sub_category varchar(100) NOT NULL CHECK(btrim(sub_category)<>''),is_enabled boolean NOT NULL DEFAULT true,deleted_at timestamptz,${audit},UNIQUE(tenant_id,id));
      CREATE UNIQUE INDEX ux_abnormal_expense_category ON abnormal_expense_categories(tenant_id,major_category,sub_category) WHERE deleted_at IS NULL;
      CREATE TABLE abnormal_cost_order_source_lines(tenant_id varchar(64) NOT NULL,source varchar(32) NOT NULL,source_line_id varchar(100) NOT NULL,payload jsonb NOT NULL,sync_batch_id uuid NOT NULL,PRIMARY KEY(tenant_id,source,source_line_id));
      CREATE TABLE abnormal_cost_order_sync_runs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,status varchar(16) NOT NULL CHECK(status IN('RUNNING','SUCCESS','FAILED')),started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,sources jsonb NOT NULL DEFAULT '[]',metrics jsonb NOT NULL DEFAULT '{}',error_code varchar(100));
      CREATE INDEX ix_abnormal_order_runs ON abnormal_cost_order_sync_runs(tenant_id,started_at DESC);
      CREATE TABLE abnormal_cost_order_source_changes(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,item_id uuid NOT NULL,batch_id uuid NOT NULL,old_source varchar(32) NOT NULL,new_source varchar(32) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,item_id) REFERENCES abnormal_cost_order_items(tenant_id,id));
      ALTER TABLE abnormal_responsibility_requests ALTER COLUMN detail_attachment DROP NOT NULL;
      ALTER TABLE abnormal_responsibility_requests ADD COLUMN item_codes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(item_codes)='array'),ADD COLUMN abnormal_quantity bigint NOT NULL DEFAULT 0 CHECK(abnormal_quantity BETWEEN 0 AND 9007199254740991),ADD COLUMN major_category varchar(100),ADD COLUMN sub_categories jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(sub_categories)='array'),ADD COLUMN order_validation_version smallint NOT NULL DEFAULT 0 CHECK(order_validation_version IN(0,1));`);
    for(const table of ['abnormal_cost_order_items','abnormal_expense_categories','abnormal_cost_order_source_lines','abnormal_cost_order_sync_runs','abnormal_cost_order_source_changes'])await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true))`);
    // Existing preset groups materialize field permissions. Inherit the original
    // order field's access for these required companion fields; never change subjects,
    // operations, scopes or custom groups.
    await r.query(`WITH inserted AS (
      INSERT INTO permissions(role_id,resource,field_key,"read","create","copy","update","delete","batch_print","batch_update","import","export",updated_by)
      SELECT p.role_id,p.resource,f.key,p."read",false,false,p."update",false,false,false,false,false,'AbnormalCostOrders137'
      FROM permissions p JOIN roles g ON g.id=p.role_id
      CROSS JOIN (VALUES('item_codes'),('abnormal_quantity'),('major_category'),('sub_categories')) f(key)
      WHERE p.resource='abnormal-responsibility-requests' AND p.field_key='order_no'
        AND g.permission_group_resource=p.resource AND g.permission_group_type IN('ADD_ONLY','ADD_MANAGE_OWN','ADD_VIEW_ALL','MANAGE_ALL','VIEW_ALL')
        AND NOT EXISTS(SELECT 1 FROM permissions e WHERE e.role_id=p.role_id AND e.resource=p.resource AND e.field_key=f.key)
      RETURNING role_id,resource,field_key,"read","update"
    ) INSERT INTO audit_logs(tenant_id,actor_name,resource,record_id,action,after_json,request_id,source,updated_by)
      SELECT NULL,'系统迁移','permissions:'||resource,role_id::text,'abnormal.required_fields.inherited',jsonb_build_object('field',field_key,'read',"read",'update',"update"),'migration:AbnormalCostOrders137','api','migration' FROM inserted`);
    const tenants=await r.query('SELECT DISTINCT tenant_id FROM users WHERE tenant_id IS NOT NULL');
    for(const {tenant_id} of tenants){
      await r.query("SELECT set_config('app.tenant_id',$1,true)",[tenant_id]);
      await r.query(`INSERT INTO abnormal_cost_order_items(tenant_id,order_no,item_code,item_name,required_quantity,order_date,customer_due_date,source) VALUES($1,'虚拟订单','虚拟品号','虚拟品名',0,'2026-01-01','2026-01-01','SYSTEM_FIXED') ON CONFLICT DO NOTHING`,[tenant_id]);
      for(const [major,sub] of abnormalExpenseCategorySeeds)await r.query('INSERT INTO abnormal_expense_categories(tenant_id,major_category,sub_category) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[tenant_id,major,sub]);
    }
  }
  async down(){throw Error('Forward-only: retain historical requests, attachments, categories and synchronized orders');}
}

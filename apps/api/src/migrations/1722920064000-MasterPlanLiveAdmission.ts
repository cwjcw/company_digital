import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KN-MPS-LIVE-002：主计划实时准入边界（只读科加账套 + 下单日期水位 + 来源身份绑定）。
 *
 * 只做新增，不重建、不清空任何主计划业务表：
 * 1) 新增 `mps_order_line_source_aliases`：ERP 来源身份 ↔ 既有主计划订单行的绑定（快照业务键抑制的落点）；
 * 2) `mps_sync_configs.watermark_at`：可选 cutover watermark（只约束**新来源身份**，默认 NULL = 不启用）；
 * 3) `mps_sync_logs.metrics`：§29 要求的扫描/准入/阻断计数（复用现有同步日志，不新建第二套日志体系）；
 * 4) 去掉 `mps_order_allocations.division_id` 的列默认值：事业部只能由客户映射派生，禁止默认值兜底；
 * 5) 更新 `shipping_edit_weekday` 的说明为多星期逗号分隔写法。
 */
export class MasterPlanLiveAdmission1722920064000 implements MigrationInterface {
  name = "MasterPlanLiveAdmission1722920064000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mps_order_line_source_aliases (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        mps_order_line_id uuid NOT NULL REFERENCES mps_erp_order_lines(id) ON DELETE RESTRICT,
        source_system varchar(32) NOT NULL,
        source_database varchar(128) NOT NULL,
        source_key varchar(255) NOT NULL,
        bound_at timestamptz NOT NULL DEFAULT now(),
        bound_reason varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid NOT NULL DEFAULT '0199e000-0000-7000-8000-000000000001'::uuid REFERENCES users(id) ON DELETE RESTRICT,
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_order_line_alias_source UNIQUE (tenant_id, source_system, source_database, source_key),
        CONSTRAINT ck_mps_order_line_alias_key CHECK (btrim(source_key) <> ''),
        CONSTRAINT ck_mps_order_line_alias_version CHECK (version > 0)
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mps_order_line_alias_target ON mps_order_line_source_aliases(tenant_id, mps_order_line_id)`);
    /* 多租户 RLS：与其它 mps_* 表完全一致的租户策略。 */
    await queryRunner.query(`ALTER TABLE mps_order_line_source_aliases ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS mps_order_line_source_aliases_tenant_policy ON mps_order_line_source_aliases`);
    await queryRunner.query(`CREATE POLICY mps_order_line_source_aliases_tenant_policy ON mps_order_line_source_aliases
      USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true))`);
    await queryRunner.query(`COMMENT ON TABLE mps_order_line_source_aliases IS 'KN-MPS-LIVE-002：ERP 来源身份 ↔ 主计划订单行绑定（快照业务键抑制后，ERP 修改直接更新原记录）'`);

    await queryRunner.query(`ALTER TABLE mps_sync_configs ADD COLUMN IF NOT EXISTS watermark_at timestamptz`);
    await queryRunner.query(`COMMENT ON COLUMN mps_sync_configs.watermark_at IS 'KN-MPS-LIVE-002：可选增量水位，只约束新 ERP 来源身份；NULL=不启用（此时由下单日期水位与来源身份判定负责准入）'`);
    await queryRunner.query(`ALTER TABLE mps_sync_logs ADD COLUMN IF NOT EXISTS metrics jsonb`);
    await queryRunner.query(`COMMENT ON COLUMN mps_sync_logs.metrics IS 'KN-MPS-LIVE-002：同步计数（scanned/eligible/inserted/updated/unchanged/duplicate_suppressed/alias_bound/blocked_by_*）'`);

    /* 事业部只能由客户→事业部映射派生：去掉列默认值，未映射订单必须留空并进入数据异常，禁止默认归入事业四部。 */
    await queryRunner.query(`ALTER TABLE mps_order_allocations ALTER COLUMN division_id DROP DEFAULT`);
    await queryRunner.query(`COMMENT ON COLUMN mps_order_allocations.division_id IS 'KN-MPS-LIVE-002：只由客户→事业部映射派生；NULL 表示未映射（禁止进入月计划并产生 MISSING_ALLOCATION_DIVISION 异常）'`);

    await queryRunner.query(`UPDATE mps_system_settings SET description='1=周一，2=周二，3=周三，4=周四，5=周五，6=周六，7=周日；多个开放星期请使用英文逗号分隔，例如：2,4,5',updated_at=now(),version=version+1
      WHERE setting_key='shipping_edit_weekday'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE mps_system_settings SET description='1=周一，5=周五，7=周日',updated_at=now(),version=version+1
      WHERE setting_key='shipping_edit_weekday'`);
    await queryRunner.query(`ALTER TABLE mps_order_allocations ALTER COLUMN division_id SET DEFAULT 'd23442f9-4862-4641-b4a7-c8d470bc56ea'::uuid`);
    await queryRunner.query(`ALTER TABLE mps_sync_logs DROP COLUMN IF EXISTS metrics`);
    await queryRunner.query(`ALTER TABLE mps_sync_configs DROP COLUMN IF EXISTS watermark_at`);
    await queryRunner.query(`DROP TABLE IF EXISTS mps_order_line_source_aliases`);
  }
}

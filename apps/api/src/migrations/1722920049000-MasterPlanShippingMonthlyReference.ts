import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanShippingMonthlyReference1722920049000 implements MigrationInterface {
  name = "MasterPlanShippingMonthlyReference1722920049000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mps_monthly_plans ADD CONSTRAINT uq_mps_monthly_tenant_id UNIQUE(tenant_id,id);
      ALTER TABLE mps_shipping_plans ADD COLUMN monthly_plan_id uuid;
      UPDATE mps_shipping_plans s SET monthly_plan_id=m.id
      FROM mps_monthly_plans m
      WHERE m.tenant_id=s.tenant_id AND m.order_number=s.order_number AND m.item_code=s.item_code;
      ALTER TABLE mps_shipping_plans ADD CONSTRAINT fk_mps_shipping_monthly_plan
        FOREIGN KEY(tenant_id,monthly_plan_id) REFERENCES mps_monthly_plans(tenant_id,id)
        ON UPDATE CASCADE ON DELETE RESTRICT;
      CREATE INDEX idx_mps_shipping_monthly_plan ON mps_shipping_plans(tenant_id,monthly_plan_id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_shipping_plans DROP CONSTRAINT IF EXISTS fk_mps_shipping_monthly_plan`);
    await queryRunner.query(`ALTER TABLE mps_shipping_plans DROP COLUMN IF EXISTS monthly_plan_id`);
    await queryRunner.query(`ALTER TABLE mps_monthly_plans DROP CONSTRAINT IF EXISTS uq_mps_monthly_tenant_id`);
  }
}

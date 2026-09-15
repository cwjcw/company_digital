import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanNonnegativeQuantities1722920054000 implements MigrationInterface {
  name = "MasterPlanNonnegativeQuantities1722920054000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_shipping_plans DROP CONSTRAINT ck_mps_shipping_plan_quantity, ADD CONSTRAINT ck_mps_shipping_plan_quantity CHECK(planned_quantity>=0)`);
    await queryRunner.query(`ALTER TABLE mps_shipping_plans DROP CONSTRAINT ck_mps_shipping_plan_delivery, ADD CONSTRAINT ck_mps_shipping_plan_delivery CHECK(delivery_number>=0)`);
    await queryRunner.query(`ALTER TABLE mps_weekly_plans DROP CONSTRAINT ck_mps_weekly_quantities, ADD CONSTRAINT ck_mps_weekly_quantities CHECK(planned_quantity>=0 AND allocated_inbound_quantity>=0 AND pending_quantity>=0)`);
    await queryRunner.query(`ALTER TABLE mps_process_reports DROP CONSTRAINT ck_mps_process_report_quantities, ADD CONSTRAINT ck_mps_process_report_quantities CHECK(planned_quantity>=0 AND production_quantity>=0)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_process_reports DROP CONSTRAINT ck_mps_process_report_quantities, ADD CONSTRAINT ck_mps_process_report_quantities CHECK(planned_quantity>0 AND production_quantity>0)`);
    await queryRunner.query(`ALTER TABLE mps_weekly_plans DROP CONSTRAINT ck_mps_weekly_quantities, ADD CONSTRAINT ck_mps_weekly_quantities CHECK(planned_quantity>0 AND allocated_inbound_quantity>=0 AND pending_quantity>=0)`);
    await queryRunner.query(`ALTER TABLE mps_shipping_plans DROP CONSTRAINT ck_mps_shipping_plan_delivery, ADD CONSTRAINT ck_mps_shipping_plan_delivery CHECK(delivery_number>0)`);
    await queryRunner.query(`ALTER TABLE mps_shipping_plans DROP CONSTRAINT ck_mps_shipping_plan_quantity, ADD CONSTRAINT ck_mps_shipping_plan_quantity CHECK(planned_quantity>0)`);
  }
}

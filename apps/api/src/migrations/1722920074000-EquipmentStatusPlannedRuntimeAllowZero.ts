import { MigrationInterface, QueryRunner } from "typeorm";

/** KN-EQUIP-STATUS-ZERO-RUNTIME-001：计划运行时间是非负分钟，0 表示该日无计划运行。 */
export class EquipmentStatusPlannedRuntimeAllowZero1722920074000 implements MigrationInterface {
  name = "EquipmentStatusPlannedRuntimeAllowZero1722920074000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE equipment_status_reports
        DROP CONSTRAINT ck_equipment_status_planned_runtime,
        ADD CONSTRAINT ck_equipment_status_planned_runtime
          CHECK (planned_runtime_minutes IS NULL OR planned_runtime_minutes >= 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚不会改写或删除业务数据；若已有 0 值记录，重新收紧约束会按数据库规则失败。
    await queryRunner.query(`
      ALTER TABLE equipment_status_reports
        DROP CONSTRAINT ck_equipment_status_planned_runtime,
        ADD CONSTRAINT ck_equipment_status_planned_runtime
          CHECK (planned_runtime_minutes IS NULL OR planned_runtime_minutes > 0)
    `);
  }
}

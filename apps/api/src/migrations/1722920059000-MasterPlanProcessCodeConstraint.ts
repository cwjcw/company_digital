import { MigrationInterface, QueryRunner } from "typeorm";

/** KN-PROC-001：周工序任务与实际报工的工序闸门必须与唯一 10 工序 registry 一致（含 blank 毛坯）。 */
const CANONICAL_CODES = ["cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "blank", "surfaceTreatment", "packaging"];
const LEGACY_CODES = ["cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "surfaceTreatment", "packaging"];
const quote = (codes: string[]) => codes.map((code) => `'${code}'`).join(",");
const CONSTRAINTS: Array<[string, string]> = [
  ["mps_weekly_process_plans", "ck_mps_weekly_process_code"],
  ["mps_process_reports", "ck_mps_process_report_code"]
];

export class MasterPlanProcessCodeConstraint1722920059000 implements MigrationInterface {
  name = "MasterPlanProcessCodeConstraint1722920059000";

  async up(queryRunner: QueryRunner): Promise<void> {
    /* 幂等：删除再按 10 工序重建，历史 9 工序数据仍然合法。 */
    for (const [table, constraint] of CONSTRAINTS) {
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
      await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK(process_code IN (${quote(CANONICAL_CODES)}))`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [table, constraint] of CONSTRAINTS) {
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
      await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK(process_code IN (${quote(LEGACY_CODES)}))`);
    }
  }
}

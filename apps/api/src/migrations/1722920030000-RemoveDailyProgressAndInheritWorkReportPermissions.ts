import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveDailyProgressAndInheritWorkReportPermissions1722920030000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions(
        id,role_id,resource,field_key,"read","create",copy,"update","delete",
        batch_print,batch_update,"import","export",updated_by
      )
      SELECT
        uuid_generate_v4(),daily.role_id,'work-report',daily.field_key,daily."read",daily."create",daily.copy,
        daily."update",daily."delete",daily.batch_print,daily.batch_update,daily."import",daily."export",'migration'
      FROM permissions daily
      WHERE daily.resource='daily-progress'
      ON CONFLICT(role_id,resource,field_key) DO UPDATE SET
        "read"=permissions."read" OR EXCLUDED."read",
        "create"=permissions."create" OR EXCLUDED."create",
        copy=permissions.copy OR EXCLUDED.copy,
        "update"=permissions."update" OR EXCLUDED."update",
        "delete"=permissions."delete" OR EXCLUDED."delete",
        batch_print=permissions.batch_print OR EXCLUDED.batch_print,
        batch_update=permissions.batch_update OR EXCLUDED.batch_update,
        "import"=permissions."import" OR EXCLUDED."import",
        "export"=permissions."export" OR EXCLUDED."export",
        version=permissions.version+1,
        updated_at=now(),
        updated_by='migration'
    `);
    await queryRunner.query(`DELETE FROM permissions WHERE resource='daily-progress'`);
    await queryRunner.query(`DROP TABLE IF EXISTS daily_process_progress`);
  }

  async down(): Promise<void> {
    // Forward-only: the retired report and its empty storage are intentionally not recreated.
  }
}

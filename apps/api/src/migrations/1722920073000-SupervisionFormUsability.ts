import { MigrationInterface, QueryRunner } from "typeorm";

/** SUPERVISION-FORM-USABILITY-002：督办人非必填，优先级只保留高/中/低。 */
export class SupervisionFormUsability1722920073000 implements MigrationInterface {
  name = "SupervisionFormUsability1722920073000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE supervision_projects
        ALTER COLUMN supervisor_id DROP NOT NULL,
        DROP CONSTRAINT ck_supervision_projects_priority,
        ADD CONSTRAINT ck_supervision_projects_priority CHECK(priority IN ('HIGH','MEDIUM','LOW'));
      ALTER TABLE supervision_tasks
        DROP CONSTRAINT ck_supervision_tasks_priority,
        ADD CONSTRAINT ck_supervision_tasks_priority CHECK(priority IN ('HIGH','MEDIUM','LOW'));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE supervision_projects
        DROP CONSTRAINT ck_supervision_projects_priority,
        ADD CONSTRAINT ck_supervision_projects_priority CHECK(priority IN ('URGENT','HIGH','MEDIUM','LOW'));
      ALTER TABLE supervision_tasks
        DROP CONSTRAINT ck_supervision_tasks_priority,
        ADD CONSTRAINT ck_supervision_tasks_priority CHECK(priority IN ('URGENT','HIGH','MEDIUM','LOW'));
      UPDATE supervision_projects SET supervisor_id=owner_id WHERE supervisor_id IS NULL;
      ALTER TABLE supervision_projects ALTER COLUMN supervisor_id SET NOT NULL;
    `);
  }
}

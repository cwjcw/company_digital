import { MigrationInterface, QueryRunner } from "typeorm";

export class UserContactFieldsAndWhiteboard1722920011000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "employee_no" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD "wechat_user_id" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD "position" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD "department_paths" jsonb NOT NULL DEFAULT '[]'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_employee_no" ON "users" ("employee_no") WHERE "employee_no" IS NOT NULL`);
    await queryRunner.query(`INSERT INTO roles (id,name,description) SELECT uuid_generate_v4(),'白板','仅允许登录，不拥有任何业务、数据或管理权限' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name='白板')`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_employee_no"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "department_paths"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "position"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "wechat_user_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "employee_no"`);
  }
}

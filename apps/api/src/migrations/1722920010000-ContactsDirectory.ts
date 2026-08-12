import { MigrationInterface, QueryRunner } from "typeorm";

export class ContactsDirectory1722920010000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "contacts" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "wechat_user_id" character varying NOT NULL,
      "employee_no" character varying, "name" character varying NOT NULL, "position" character varying,
      "telephone" character varying, "direct_leaders" jsonb NOT NULL DEFAULT '[]',
      "department_paths" jsonb NOT NULL DEFAULT '[]', "enabled" boolean NOT NULL DEFAULT true,
      "imported_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      CONSTRAINT "PK_contacts" PRIMARY KEY ("id"), CONSTRAINT "UQ_contacts_wechat_user_id" UNIQUE ("wechat_user_id"))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`DROP TABLE "contacts"`); }
}

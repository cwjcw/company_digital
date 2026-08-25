import { MigrationInterface, QueryRunner } from "typeorm";

export class EmployeeProfileAndRoleGroups1722920025000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "alias" character varying;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gender" character varying;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mobile" character varying;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" character varying;

      CREATE TABLE IF NOT EXISTS "role_groups" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" character varying NOT NULL UNIQUE,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" character varying NOT NULL DEFAULT 'system'
      );

      ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "role_group_id" uuid;
      DO $$ BEGIN
        ALTER TABLE "roles" ADD CONSTRAINT "FK_roles_role_group"
          FOREIGN KEY ("role_group_id") REFERENCES "role_groups"("id") ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      INSERT INTO "role_groups" ("name", "sort_order", "updated_by")
      VALUES ('系统角色', 0, 'migration') ON CONFLICT ("name") DO NOTHING;
      UPDATE "roles" SET "role_group_id"=(SELECT "id" FROM "role_groups" WHERE "name"='系统角色')
      WHERE "role_group_id" IS NULL;
    `);
  }

  async down(): Promise<void> { /* Forward-only: employee profile and role grouping data are retained. */ }
}

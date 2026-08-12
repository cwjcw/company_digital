import { MigrationInterface, QueryRunner } from "typeorm";

export class RoleOrganizationScopes1722920012000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "role_organization_scopes" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "role_id" uuid NOT NULL, "organization_unit_id" uuid NOT NULL,
      CONSTRAINT "PK_role_organization_scopes" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_role_organization_scopes" UNIQUE ("role_id", "organization_unit_id"))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`DROP TABLE "role_organization_scopes"`); }
}

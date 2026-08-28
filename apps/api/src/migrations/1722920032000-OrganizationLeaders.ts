import { MigrationInterface, QueryRunner } from "typeorm";

export class OrganizationLeaders1722920032000 implements MigrationInterface {
  name = "OrganizationLeaders1722920032000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organization_units ADD COLUMN IF NOT EXISTS leader_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE organization_units ADD CONSTRAINT organization_units_leader_user_ids_array_ck CHECK (jsonb_typeof(leader_user_ids) = 'array')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE organization_units DROP CONSTRAINT IF EXISTS organization_units_leader_user_ids_array_ck`);
    await queryRunner.query(`ALTER TABLE organization_units DROP COLUMN IF EXISTS leader_user_ids`);
  }
}

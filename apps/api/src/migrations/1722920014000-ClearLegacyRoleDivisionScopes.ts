import { MigrationInterface, QueryRunner } from "typeorm";

export class ClearLegacyRoleDivisionScopes1722920014000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> { await queryRunner.query(`DELETE FROM role_data_scopes`); }
  async down(): Promise<void> {}
}

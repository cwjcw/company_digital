import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveProcessEditorRole1722920013000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE name='工序编辑')`);
    await queryRunner.query(`DELETE FROM permissions WHERE role_id IN (SELECT id FROM roles WHERE name='工序编辑')`);
    await queryRunner.query(`DELETE FROM role_data_scopes WHERE role_id IN (SELECT id FROM roles WHERE name='工序编辑')`);
    await queryRunner.query(`DELETE FROM role_organization_scopes WHERE role_id IN (SELECT id FROM roles WHERE name='工序编辑')`);
    await queryRunner.query(`DELETE FROM roles WHERE name='工序编辑'`);
  }
  async down(): Promise<void> {}
}

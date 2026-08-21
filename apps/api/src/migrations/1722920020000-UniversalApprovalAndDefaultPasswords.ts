import { MigrationInterface, QueryRunner } from "typeorm";

export class UniversalApprovalAndDefaultPasswords1722920020000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "title" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "category" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "description" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "requester_manager_id" DROP NOT NULL`);
    await queryRunner.query(`UPDATE "development_requests" SET "status" = 'DRAFT' WHERE "status" = 'REQUESTER_REJECTED'`);
    await queryRunner.query(`UPDATE "development_requests" SET "status" = 'PENDING_HANDLER_PLAN' WHERE "status" = 'HANDLER_MANAGER_REJECTED'`);
    await queryRunner.query(`
      UPDATE "users"
      SET "password_hash" = '$2b$12$sdk44B5kupswkF/YEGXg0uo4XNGsB09jyPE/.Ac0.VQdnfocn4q4K',
          "must_change_password" = true,
          "updated_at" = now(),
          "updated_by" = 'migration:default-password'
      WHERE lower(trim("username")) <> 'admin'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const incomplete = await queryRunner.query(`
      SELECT count(*)::integer AS count FROM "development_requests"
      WHERE "title" IS NULL OR "category" IS NULL OR "description" IS NULL OR "requester_manager_id" IS NULL
    `);
    if (Number(incomplete[0]?.count ?? 0) > 0) throw new Error("存在未填写完整的需求草稿，不能恢复非空约束");
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "requester_manager_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "description" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "category" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "development_requests" ALTER COLUMN "title" SET NOT NULL`);
    // Password hashes are intentionally not reversible.
  }
}

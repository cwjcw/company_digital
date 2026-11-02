import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the customer delivery date separately from the existing latest review date. */
export class MpsReviewDueDateSeparateDueDate1722920116000 implements MigrationInterface {
  name = 'MpsReviewDueDateSeparateDueDate1722920116000';

  async up(r: QueryRunner) {
    await r.query(`ALTER TABLE mps_review_due_dates ADD COLUMN due_date date;
      ALTER TABLE mps_review_due_dates ALTER COLUMN inbound_date DROP NOT NULL;
      COMMENT ON COLUMN mps_review_due_dates.due_date IS 'Excel F列交期；与原inbound_date（现显示最新交期）分开存储';
      COMMENT ON COLUMN mps_review_due_dates.inbound_date IS '原稳定字段身份；当前业务显示名称为最新交期，保留历史日期字段兼容';`);
  }

  async down(): Promise<void> {
    throw new Error('新增交期字段可能已承载业务数据；仅回滚应用，不删除该列。');
  }
}

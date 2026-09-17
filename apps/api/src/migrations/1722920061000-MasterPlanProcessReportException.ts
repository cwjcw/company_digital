import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KN-MPS-UI-001：工序实际报工是「生产异常」的唯一事实来源之一，因此 mps_process_reports 必须支持人工填写的异常文本。
 * - 可空，没有系统默认值：系统绝不自动写入「未维护工序周期」之类的提示/校验文本；
 * - 与其它报工表（技术/主材/外协）的 exception_text 语义、类型保持一致（text NULL）。
 */
export class MasterPlanProcessReportException1722920061000 implements MigrationInterface {
  name = "MasterPlanProcessReportException1722920061000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_process_reports ADD COLUMN IF NOT EXISTS exception_text text NULL`);
    await queryRunner.query(`COMMENT ON COLUMN mps_process_reports.exception_text IS 'KN-MPS-UI-001：人工填写的实际生产异常（可空）；系统不得自动写入计划提示或校验信息'`);

    /*
     * 字段权限回填：字段权限按“保存权限组时materialize”写入，新增字段不会自动出现在已保存的权限组里。
     * 这里按与 TablePermissionGroupApplicationService.fields() 完全相同的规则回填（可读组 → 可见；
     * 具备修改权限的组 → 可编辑），否则已有报工权限组看不到也填不了「异常」。
     * 幂等：仅当该组尚无 exceptionText 行时插入。
     */
    /* permissions 的列名 create/update/delete/read/... 是 SQL 保留字，必须加双引号。 */
    await queryRunner.query(`INSERT INTO permissions(role_id,resource,field_key,"read","create","copy","update","delete","batch_print","batch_update","import","export",updated_by)
      SELECT role.id,'mps-process-reports','exceptionText',true,false,false,COALESCE(operation.update,false),false,false,false,false,false,'KN-MPS-UI-001'
      FROM roles role
      LEFT JOIN permissions operation ON operation.role_id=role.id AND operation.resource='mps-process-reports' AND operation.field_key='*'
      WHERE role.permission_group_resource='mps-process-reports'
        AND COALESCE(operation."read",false)=true
        AND NOT EXISTS (SELECT 1 FROM permissions existing WHERE existing.role_id=role.id AND existing.resource='mps-process-reports' AND existing.field_key='exceptionText')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM permissions WHERE resource='mps-process-reports' AND field_key='exceptionText'`);
    await queryRunner.query(`ALTER TABLE mps_process_reports DROP COLUMN IF EXISTS exception_text`);
  }
}

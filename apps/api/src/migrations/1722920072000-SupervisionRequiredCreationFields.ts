import { MigrationInterface, QueryRunner } from "typeorm";

/** KDOS-PROJECT-TASK-SUPERVISION-002：督办创建字段补齐；存量历史记录不伪造必填业务数据。 */
export class SupervisionRequiredCreationFields1722920072000 implements MigrationInterface {
  name = "SupervisionRequiredCreationFields1722920072000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE supervision_projects
        ADD COLUMN project_description text NULL,
        ADD COLUMN actual_delivery_date date NULL;
      ALTER TABLE supervision_tasks
        ADD COLUMN actual_delivery_date date NULL;
    `);
    /* 已保存权限组的字段权限是物化快照；新增字段须按既有读/改操作回填。 */
    await queryRunner.query(`INSERT INTO permissions(role_id,resource,field_key,"read","create","copy","update","delete","batch_print","batch_update","import","export",updated_by)
      SELECT role.id,source.resource,source.field_key,true,false,false,COALESCE(operation.update,false),false,false,false,false,false,'KDOS-PROJECT-TASK-SUPERVISION-002'
      FROM roles role
      CROSS JOIN (VALUES
        ('supervision-projects','projectDescription'),
        ('supervision-projects','actualDeliveryDate'),
        ('supervision-tasks','actualDeliveryDate')
      ) AS source(resource,field_key)
      LEFT JOIN permissions operation ON operation.role_id=role.id AND operation.resource=source.resource AND operation.field_key='*'
      WHERE role.permission_group_resource=source.resource
        AND COALESCE(operation."read",false)=true
        AND NOT EXISTS (
          SELECT 1 FROM permissions existing
          WHERE existing.role_id=role.id AND existing.resource=source.resource AND existing.field_key=source.field_key
        )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM permissions WHERE (resource='supervision-projects' AND field_key IN ('projectDescription','actualDeliveryDate')) OR (resource='supervision-tasks' AND field_key='actualDeliveryDate')`);
    await queryRunner.query(`ALTER TABLE supervision_tasks DROP COLUMN IF EXISTS actual_delivery_date`);
    await queryRunner.query(`ALTER TABLE supervision_projects DROP COLUMN IF EXISTS actual_delivery_date, DROP COLUMN IF EXISTS project_description`);
  }
}

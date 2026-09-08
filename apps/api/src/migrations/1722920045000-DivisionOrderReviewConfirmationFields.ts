import { MigrationInterface, QueryRunner } from "typeorm";

export class DivisionOrderReviewConfirmationFields1722920045000 implements MigrationInterface {
  name = "DivisionOrderReviewConfirmationFields1722920045000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`INSERT INTO permissions(
        id,role_id,resource,field_key,"read","create",copy,"update","delete",batch_print,batch_update,"import","export",created_by,updated_by
      )
      SELECT uuid_generate_v4(),operation.role_id,'division-order-review',field.field_key,
        operation."read",false,false,
        CASE WHEN field.field_key='divisionReviewDueDate' THEN operation."update" ELSE false END,
        false,false,false,false,false,NULL,'system'
      FROM permissions operation
      JOIN roles role ON role.id=operation.role_id
      CROSS JOIN (VALUES ('divisionReviewDueDate'),('deliveryConfirmation')) field(field_key)
      WHERE operation.resource='division-order-review' AND operation.field_key='*'
        AND role.permission_group_resource='division-order-review'
        AND role.permission_group_type IS NOT NULL AND role.permission_group_type<>'CUSTOM'
      ON CONFLICT(role_id,resource,field_key) DO UPDATE
      SET "read"=EXCLUDED."read","update"=EXCLUDED."update",updated_at=now(),updated_by='system',version=permissions.version+1`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM permissions permission
      USING roles role
      WHERE permission.role_id=role.id AND permission.resource='division-order-review'
        AND permission.field_key IN ('divisionReviewDueDate','deliveryConfirmation')
        AND role.permission_group_resource='division-order-review'
        AND role.permission_group_type IS NOT NULL AND role.permission_group_type<>'CUSTOM'`);
  }
}

import { MigrationInterface, QueryRunner } from "typeorm";

export class StandardizeMonthlyPlanAndDictionaries1722920015000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE process_definitions
      SET enable_required_days = true, enable_due_date = true, enable_status = true, enable_exception = true
      WHERE code IN ('frontParts', 'machining', 'welding', 'grinding', 'woodwork', 'painting', 'acrylic', 'rearPackingParts');

      UPDATE outsourcing_details SET method = '成品' WHERE method = '成品外协';
      UPDATE outsourcing_details SET method = '毛坯' WHERE method = '毛坯外协';
      UPDATE outsourcing_details SET method = '部件' WHERE method = '工序外协';

      UPDATE dictionary_types SET name = '制作方式' WHERE code = 'handlingMethod';
      UPDATE dictionary_types SET name = '外协方式' WHERE code = 'outsourcingMethod';

      DELETE FROM dictionary_values
      WHERE type_id IN (SELECT id FROM dictionary_types WHERE code IN ('handlingMethod', 'outsourcingMethod'));

      INSERT INTO dictionary_values(type_id, value, sort_order, enabled)
      SELECT id, value, sort_order, true
      FROM dictionary_types
      CROSS JOIN (VALUES
        ('自制', 0), ('中心外购', 1), ('外协', 2), ('自制+外协', 3)
      ) AS handling(value, sort_order)
      WHERE code = 'handlingMethod';

      INSERT INTO dictionary_values(type_id, value, sort_order, enabled)
      SELECT id, value, sort_order, true
      FROM dictionary_types
      CROSS JOIN (VALUES
        ('成品', 0), ('毛坯', 1), ('部件', 2)
      ) AS outsourcing(value, sort_order)
      WHERE code = 'outsourcingMethod';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE process_definitions
      SET enable_required_days = false, enable_exception = false
      WHERE code IN ('frontParts', 'machining', 'welding', 'grinding', 'woodwork', 'painting', 'acrylic', 'rearPackingParts');

      UPDATE outsourcing_details SET method = '成品外协' WHERE method = '成品';
      UPDATE outsourcing_details SET method = '毛坯外协' WHERE method = '毛坯';
      UPDATE outsourcing_details SET method = '工序外协' WHERE method = '部件';

      UPDATE dictionary_types SET name = 'handlingMethod' WHERE code = 'handlingMethod';
      UPDATE dictionary_types SET name = 'outsourcingMethod' WHERE code = 'outsourcingMethod';

      DELETE FROM dictionary_values
      WHERE type_id IN (SELECT id FROM dictionary_types WHERE code IN ('handlingMethod', 'outsourcingMethod'));

      INSERT INTO dictionary_values(type_id, value, sort_order, enabled)
      SELECT id, value, sort_order, true
      FROM dictionary_types
      CROSS JOIN (VALUES ('自制', 0), ('外协', 1)) AS handling(value, sort_order)
      WHERE code = 'handlingMethod';

      INSERT INTO dictionary_values(type_id, value, sort_order, enabled)
      SELECT id, value, sort_order, true
      FROM dictionary_types
      CROSS JOIN (VALUES ('成品外协', 0), ('毛坯外协', 1), ('工序外协', 2)) AS outsourcing(value, sort_order)
      WHERE code = 'outsourcingMethod';
    `);
  }
}

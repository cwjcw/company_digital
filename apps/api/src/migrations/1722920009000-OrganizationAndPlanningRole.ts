import { MigrationInterface, QueryRunner } from "typeorm";

export class OrganizationAndPlanningRole1722920009000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "organization_units" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "level" smallint NOT NULL,
        "parent_id" uuid,
        "division" character varying,
        "enabled" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_organization_units" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_organization_units_parent_name" UNIQUE ("parent_id", "name")
      )
    `);
    // 兼容已存在的旧角色；若目标角色已经手工建立，则保留其记录避免唯一键冲突。
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM roles WHERE name = '管理员')
           AND NOT EXISTS (SELECT 1 FROM roles WHERE name = '集团管理员') THEN
          UPDATE roles SET name = '集团管理员', description = '可管理用户、角色、组织与表格权限；不能管理 API Key' WHERE name = '管理员';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM roles WHERE name = '事业部计划组') THEN
          INSERT INTO roles (id, name, description) VALUES (uuid_generate_v4(), '事业部计划组', '按本人所属事业部查看已获授权表格的数据');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      INSERT INTO permissions (id, role_id, resource, field_key, "read", "create", "update", "delete", "import", "export")
      SELECT uuid_generate_v4(), id, 'sales-summary-dashboard', '*', true, true, true, true, true, true
      FROM roles WHERE name = '集团管理员'
      ON CONFLICT (role_id, resource, field_key) DO NOTHING
    `);
    // 初始化一个完整的五级范例；现有“事业部”字典值会自动作为第三级并各自带计划组。
    await queryRunner.query(`
      DO $$
      DECLARE root_id uuid; group_id uuid; division_row record; division_id uuid; department_id uuid;
      BEGIN
        SELECT id INTO root_id FROM organization_units WHERE parent_id IS NULL AND name = '凯南集团' LIMIT 1;
        IF root_id IS NULL THEN INSERT INTO organization_units (name, level, parent_id, sort_order) VALUES ('凯南集团', 1, NULL, 1) RETURNING id INTO root_id; END IF;
        SELECT id INTO group_id FROM organization_units WHERE parent_id = root_id AND name = '制造事业群' LIMIT 1;
        IF group_id IS NULL THEN INSERT INTO organization_units (name, level, parent_id, sort_order) VALUES ('制造事业群', 2, root_id, 1) RETURNING id INTO group_id; END IF;
        FOR division_row IN SELECT dv.value FROM dictionary_values dv JOIN dictionary_types dt ON dt.id = dv.type_id WHERE dt.code = 'division' AND dv.enabled LOOP
          SELECT id INTO division_id FROM organization_units WHERE parent_id = group_id AND name = division_row.value LIMIT 1;
          IF division_id IS NULL THEN INSERT INTO organization_units (name, level, parent_id, division, sort_order) VALUES (division_row.value, 3, group_id, division_row.value, 1) RETURNING id INTO division_id; END IF;
          SELECT id INTO department_id FROM organization_units WHERE parent_id = division_id AND name = '计划管理部' LIMIT 1;
          IF department_id IS NULL THEN INSERT INTO organization_units (name, level, parent_id, division, sort_order) VALUES ('计划管理部', 4, division_id, division_row.value, 1) RETURNING id INTO department_id; END IF;
          IF NOT EXISTS (SELECT 1 FROM organization_units WHERE parent_id = department_id AND name = '事业部计划组') THEN
            INSERT INTO organization_units (name, level, parent_id, division, sort_order) VALUES ('事业部计划组', 5, department_id, division_row.value, 1);
          END IF;
        END LOOP;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "organization_units"`);
  }
}

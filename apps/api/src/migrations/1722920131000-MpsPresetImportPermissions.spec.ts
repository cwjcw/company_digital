import { MpsPresetImportPermissions1722920131000 } from "./1722920131000-MpsPresetImportPermissions";

describe("MpsPresetImportPermissions migration", () => {
  it("updates only import on wildcard rows for the five preset groups and writes an audit trail", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MpsPresetImportPermissions1722920131000().up({ query } as never);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("r.permission_group_type IN ('ADD_ONLY','ADD_MANAGE_OWN','ADD_VIEW_ALL','MANAGE_ALL','VIEW_ALL')");
    expect(sql).toContain("p.field_key='*'");
    expect(sql).toContain('UPDATE permissions p SET "import"=(r.permission_group_type <> \'VIEW_ALL\')');
    expect(sql).toContain("table_permission_group.preset_import_matrix_migrated");
    expect(sql).toContain("'api',NULL,'migration'");
    expect(sql).not.toMatch(/permission_group_subjects|permission_group_scope|permission_group_data_rules|p\.update\s*=/i);
  });

  it("keeps permission grants forward-only during rollback", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MpsPresetImportPermissions1722920131000().down({ query } as never);
    expect(query).toHaveBeenCalledWith("SELECT 1");
  });
});

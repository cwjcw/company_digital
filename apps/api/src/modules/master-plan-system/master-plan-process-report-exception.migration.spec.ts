import { MasterPlanProcessReportException1722920061000 } from "../../migrations/1722920061000-MasterPlanProcessReportException";

describe("MasterPlanProcessReportException1722920061000", () => {
  it("adds the nullable report exception column and backfills the field permission for existing groups", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanProcessReportException1722920061000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    /* 工序报工的人工异常事实：可空、无系统默认文本、绝不自动填入提示。 */
    expect(sql).toContain("ALTER TABLE mps_process_reports ADD COLUMN IF NOT EXISTS exception_text text NULL");
    expect(sql).toContain("COMMENT ON COLUMN mps_process_reports.exception_text IS");
    expect(sql).toContain("系统不得自动写入计划提示或校验信息");
    /* 新增字段必须回填字段权限，否则已有报工权限组看不到也填不了异常。 */
    /* permissions 的 create/update/delete/read 是 SQL 保留字，必须加引号，否则 migration 在生产直接语法报错。 */
    expect(sql).toContain(`INSERT INTO permissions(role_id,resource,field_key,"read","create","copy","update","delete","batch_print","batch_update","import","export",updated_by)`);
    expect(sql).toContain("'mps-process-reports','exceptionText',true,false,false,COALESCE(operation.update,false)");
    expect(sql).toContain("LEFT JOIN permissions operation ON operation.role_id=role.id AND operation.resource='mps-process-reports' AND operation.field_key='*'");
    expect(sql).toContain("role.permission_group_resource='mps-process-reports'");
    expect(sql).toContain(`COALESCE(operation."read",false)=true`);
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM permissions existing WHERE existing.role_id=role.id AND existing.resource='mps-process-reports' AND existing.field_key='exceptionText')");
  });

  it("rolls back by dropping the column and the backfilled field permission", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanProcessReportException1722920061000().down({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    expect(sql).toContain("DELETE FROM permissions WHERE resource='mps-process-reports' AND field_key='exceptionText'");
    expect(sql).toContain("ALTER TABLE mps_process_reports DROP COLUMN IF EXISTS exception_text");
  });
});

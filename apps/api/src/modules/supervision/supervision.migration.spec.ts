import { ProjectTaskSupervision1722920071000 } from "../../migrations/1722920071000-ProjectTaskSupervision";
import { SupervisionRequiredCreationFields1722920072000 } from "../../migrations/1722920072000-SupervisionRequiredCreationFields";

describe("任务督办 migration", () => {
  it("创建三类明确业务实体、租户复合外键、约束、索引与 RLS，且不创建订单项目表", async () => {
    const statements: string[] = [];
    await new ProjectTaskSupervision1722920071000().up({ query: async (sql: string) => { statements.push(sql); return []; } } as any);
    const sql = statements.join("\n");
    expect(sql).toContain("CREATE TABLE supervision_projects");
    expect(sql).toContain("CREATE TABLE supervision_tasks");
    expect(sql).toContain("CREATE TABLE supervision_task_progress");
    expect(sql).toContain("FOREIGN KEY(tenant_id,project_id)");
    expect(sql).toContain("FOREIGN KEY(tenant_id,task_id,project_id)");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("current_setting('app.tenant_id',true)");
    expect(sql).toContain("progress>=0 AND progress<=100");
    expect(sql).toContain("lifecycle_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','ABORTED')");
    expect(sql).not.toMatch(/order_projects|order_project_management/i);
  });
});

describe("任务督办创建字段 migration", () => {
  it("新增项目描述与实际交付日期，并按既有权限组回填字段权限", async () => {
    const statements: string[] = [];
    await new SupervisionRequiredCreationFields1722920072000().up({ query: async (sql: string) => { statements.push(sql); return []; } } as any);
    const sql = statements.join("\n");
    expect(sql).toContain("ADD COLUMN project_description text NULL");
    expect(sql).toContain("ADD COLUMN actual_delivery_date date NULL");
    expect(sql).toContain("('supervision-projects','projectDescription')");
    expect(sql).toContain("('supervision-projects','actualDeliveryDate')");
    expect(sql).toContain("('supervision-tasks','actualDeliveryDate')");
    expect(sql).toContain("COALESCE(operation.update,false)");
  });
});

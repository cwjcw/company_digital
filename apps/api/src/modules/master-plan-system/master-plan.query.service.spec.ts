import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { MasterPlanQueryService } from "./master-plan.query.service";
import type { MasterPlanActor } from "./master-plan.types";

const actor = (permissions: string[]): MasterPlanActor => ({
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-1", source: "web"
});

describe("MasterPlanQueryService metadata", () => {
  const directory = { listEnabled: jest.fn().mockResolvedValue([{ id: "org-1", name: "事业一部", pathLabel: "凯南 / 事业一部" }]) };
  const service = new MasterPlanQueryService({} as never, directory as never);

  it("never exposes direct weekly-plan creation even when a create claim exists", () => {
    const allowed = service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:read", "mps-weekly-plans:*:create", "mps-weekly-plans:orderNumber:read"]));
    expect(allowed.actions.create).toBe(false);
    expect(allowed.createFields).toEqual([]);

    const denied = service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:read", "mps-weekly-plans:orderNumber:read"]));
    expect(denied.actions.create).toBe(false);
    expect(denied.createFields).toEqual([]);
  });

  it("uses deterministic aggregates so duplicate historical children cannot crash weekly list", async () => {
    const query = jest.fn(async (sql: string) => sql.includes("count(*)::integer count") ? [{ count: 1 }] : [{ id: "weekly-1", version: 1 }]);
    const weeklyActor = { ...actor(["*"]), isSystemAdmin: true };
    const result = await new MasterPlanQueryService({ query } as never, directory as never).list("mps-weekly-plans", {}, weeklyActor);
    const dataSql = query.mock.calls.map(([sql]) => sql).find((sql) => sql.startsWith("SELECT record.id")) ?? "";
    expect(result.total).toBe(1);
    expect(dataSql).toContain("string_agg(DISTINCT report.exception_text");
    expect(dataSql).toContain("bool_or(report.status='延期')");
    expect(dataSql).toContain("bool_or(report.received OR report.actual_inbound_date IS NOT NULL)");
    expect(dataSql).not.toContain("(SELECT status FROM mps_technical_reports");
  });

  it("still requires read permission to open a table", () => {
    expect(() => service.metadata("mps-weekly-plans", actor(["mps-weekly-plans:*:create"]))).toThrow(ForbiddenException);
  });

  it("authorizes organization references against the actual resource and department field", async () => {
    await expect(service.organizationOptions("mps-shipping-plans", actor(["mps-shipping-plans:*:read", "mps-shipping-plans:divisionId:read"]))).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "org-1" })]));
    await expect(service.organizationOptions("mps-shipping-plans", actor(["mps-monthly-plans:*:read", "mps-monthly-plans:divisionId:read"]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.organizationOptions("mps-shipping-plans", actor(["mps-shipping-plans:*:read"]))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("MasterPlanQueryService base plan weekly feedback", () => {
  const directory = { listEnabled: jest.fn().mockResolvedValue([]) };
  const basePlanId = "22222222-2222-4222-8222-222222222222";
  const basePlanActor = actor(["mps-base-plans:*:read", "mps-weekly-plans:*:read"]);

  it("exposes the read-only weekly state fields and the locator action from the same admission rule", () => {
    const metadata = new MasterPlanQueryService({} as never, directory as never).metadata("mps-base-plans", basePlanActor);
    const keys = metadata.fields.map((field) => field.key);
    expect(keys).toEqual(expect.arrayContaining(["weeklyPlanState", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue"]));
    expect(metadata.fields.filter((field) => field.key.startsWith("weeklyPlan")).every((field) => field.editable === false)).toBe(true);
    expect(metadata.createFields.map((field) => field.key)).not.toEqual(expect.arrayContaining(["weeklyPlanState", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue"]));
    expect(metadata.actions.viewWeekly).toBe(true);
    expect(new MasterPlanQueryService({} as never, directory as never).metadata("mps-base-plans", actor(["mps-base-plans:*:read"])).actions.viewWeekly).toBe(false);
  });

  it("derives the base-plan state, missing items and failure hint from base_plan_id and the shared admission rule", async () => {
    const query = jest.fn(async (sql: string) => sql.includes("count(*)::integer count") ? [{ count: 1 }] : [{ id: basePlanId, version: 1 }]);
    const result = await new MasterPlanQueryService({ query } as never, directory as never).list("mps-base-plans", {}, basePlanActor);
    const dataSql = query.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.startsWith("SELECT record.id")) ?? "";

    expect(result.visibleFields).toEqual(expect.arrayContaining(["weeklyPlanState", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue"]));
    expect(dataSql).toContain("weekly.base_plan_id=record.id");
    expect(dataSql).toContain("FROM mps_reconciliation_outbox event");
    expect(dataSql).toContain("event.record_id=record.id");
    expect(dataSql).toContain("THEN '已进入周计划'");
    expect(dataSql).toContain("NULLIF(btrim(record.latest_review_due_date::text),'') IS NOT NULL");
    expect(dataSql).toContain("'最迟评审交期'");
    expect(dataSql).toContain(`(SELECT weekly.id FROM mps_weekly_plans weekly WHERE weekly.tenant_id=record.tenant_id AND weekly.base_plan_id=record.id) "weeklyPlanId"`);
  });

  it("locates exactly one weekly plan by validated base_plan_id and rejects anything else", async () => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 0 }] : []);
    const service = new MasterPlanQueryService({ query } as never, directory as never);
    const weeklyActor = actor(["mps-weekly-plans:*:read", "mps-weekly-plans:orderNumber:read"]);

    await service.list("mps-weekly-plans", { basePlanId }, weeklyActor);
    const located = query.mock.calls.at(0)!;
    expect(String(located[0])).toContain("record.base_plan_id=$2::uuid");
    expect(located[1]).toEqual(["KAINAN", basePlanId]);

    await expect(service.list("mps-weekly-plans", { basePlanId: "SO-1" }, weeklyActor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list("mps-weekly-plans", { basePlanId: "abc" }, weeklyActor)).rejects.toBeInstanceOf(BadRequestException);

    const beforeUnrelated = query.mock.calls.length;
    const unrelated = new MasterPlanQueryService({ query } as never, directory as never);
    await unrelated.list("mps-base-plans", { basePlanId }, basePlanActor);
    expect(query.mock.calls.slice(beforeUnrelated).map(([sql]) => String(sql)).some((sql) => sql.includes("record.base_plan_id="))).toBe(false);
  });
});

describe("MasterPlanQueryService dictionary filters", () => {
  const directory = { listEnabled: jest.fn().mockResolvedValue([]) };
  const fullActor: MasterPlanActor = { ...actor(["*"]), isSystemAdmin: true };
  const processRow = { id: "row-1", version: 1, processCode: "bending", processName: "折弯" };

  const runList = async (code: string, input: Record<string, unknown>, serviceActor: MasterPlanActor = fullActor) => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 1 }] : [processRow]);
    const result = await new MasterPlanQueryService({ query } as never, directory as never).list(code, input, serviceActor);
    return { result, calls: query.mock.calls.map(([sql, params]) => ({ sql: String(sql), params: (params ?? []) as unknown[] })) };
  };
  const valueParam = (params: unknown[], expected: unknown) => params.some((entry) => Array.isArray(entry) ? entry.includes(expected) : entry === expected);

  it.each([
    ["折弯", "bending"], ["bending", "bending"], ["下料", "cutting"], ["机加", "machining"], ["点焊", "spotWelding"], ["表面处理", "surfaceTreatment"]
  ])("resolves process filter %s to the stored dictionary value %s", async (input, expected) => {
    const { calls } = await runList("mps-process-reports", { filters: JSON.stringify({ processCode: input }) });
    const dataCall = calls.find((call) => call.sql.startsWith("SELECT record.id"))!;
    expect(dataCall.sql).toContain("record.process_code::text = ANY($");
    expect(dataCall.sql).not.toContain("process_code::text,'') ILIKE");
    expect(valueParam(dataCall.params, expected)).toBe(true);
  });

  it("resolves a fuzzy option label to every matching stored value without sending the label to the value column", async () => {
    const { calls } = await runList("mps-process-reports", { filters: JSON.stringify({ processCode: "焊" }) });
    const dataCall = calls.find((call) => call.sql.startsWith("SELECT record.id"))!;
    expect(valueParam(dataCall.params, "spotWelding")).toBe(true);
    expect(valueParam(dataCall.params, "welding")).toBe(true);
    expect(dataCall.params.some((entry) => Array.isArray(entry) && entry.length === 2)).toBe(true);
    expect(JSON.stringify(dataCall.params)).not.toContain("焊");
  });

  it("returns no rows when a dictionary filter matches no option instead of falling back to label ILIKE", async () => {
    const { calls } = await runList("mps-process-reports", { filters: JSON.stringify({ processCode: "折弯X" }) });
    const dataCall = calls.find((call) => call.sql.startsWith("SELECT record.id"))!;
    expect(dataCall.sql).toContain("1=0");
    expect(dataCall.sql).not.toContain("process_code::text,'') ILIKE");
  });

  it("applies the same dictionary resolution to the pending process-report task view", async () => {
    const { calls } = await runList("mps-process-reports", { view: "PENDING", filters: JSON.stringify({ processCode: "折弯" }) });
    const dataCall = calls.find((call) => call.sql.startsWith("WITH record AS"))!;
    expect(dataCall.sql).toContain("FROM mps_weekly_process_plans task");
    expect(dataCall.sql).toContain("record.process_code::text = ANY($");
    expect(valueParam(dataCall.params, "bending")).toBe(true);
  });

  it("keeps plain ILIKE filtering for fields without option definitions", async () => {
    const { calls } = await runList("mps-process-reports", { filters: JSON.stringify({ itemName: "测试品项" }) });
    const dataCall = calls.find((call) => call.sql.startsWith("SELECT record.id"))!;
    expect(dataCall.sql).toContain("record.item_name::text,'') ILIKE $");
    expect(valueParam(dataCall.params, "%测试品项%")).toBe(true);
  });

  it.each([
    ["mps-weekly-plans", "manufacturingMethod", "自制"],
    ["mps-base-plans", "productAttribute", "五金"],
    ["mps-shipping-plans", "modelAge", "新"]
  ])("keeps dictionary fields whose value equals the label working on %s", async (code, field, value) => {
    const { calls } = await runList(code, { filters: JSON.stringify({ [field]: value }) });
    const dataCall = calls.find((call) => call.sql.startsWith("SELECT record.id"))!;
    expect(dataCall.sql).toContain("= ANY($");
    expect(valueParam(dataCall.params, value)).toBe(true);
  });

  it("also resolves option labels in the global search without dropping the text alternatives", async () => {
    const { calls } = await runList("mps-process-reports", { search: "折弯" });
    const dataCall = calls.find((call) => call.sql.startsWith("SELECT record.id"))!;
    expect(dataCall.sql).toContain("ILIKE $");
    expect(dataCall.sql).toContain("record.process_code::text = ANY($");
    expect(valueParam(dataCall.params, "%折弯%")).toBe(true);
    expect(valueParam(dataCall.params, "bending")).toBe(true);
  });

  it("ignores filters for fields without read permission", async () => {
    const scoped: MasterPlanActor = actor(["mps-process-reports:*:read", "mps-process-reports:itemName:read"]);
    const { calls } = await runList("mps-process-reports", { filters: JSON.stringify({ processCode: "折弯" }) }, scoped);
    const dataCall = calls.find((call) => call.sql.startsWith("SELECT record.id"))!;
    expect(dataCall.sql).not.toContain("process_code");
    expect(valueParam(dataCall.params, "bending")).toBe(false);
  });

  it("keeps export consistent with the list for dictionary filters", async () => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 1 }] : [processRow]);
    const service = new MasterPlanQueryService({ query } as never, directory as never);
    const exported = await service.exportRows("mps-process-reports", { filters: JSON.stringify({ processCode: "折弯" }) }, fullActor);
    const dataCall = query.mock.calls.find(([sql]) => String(sql).startsWith("SELECT record.id"))!;
    expect(exported.rows).toEqual([processRow]);
    expect(String(dataCall[0])).toContain("record.process_code::text = ANY($");
    expect(valueParam(dataCall[1] as unknown[], "bending")).toBe(true);
  });
});

describe("MasterPlanQueryService report divisions", () => {
  const organization = { id: "22222222-2222-4222-8222-222222222222", name: "事业一部", pathLabel: "凯南 / 制造中心 / 事业一部" };

  it.each(["mps-technical-reports", "mps-material-reports", "mps-outsourcing-reports", "mps-process-reports"])("applies division field permission, path filter, data scope and export to %s", async (resource) => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 1 }] : [{ id: "row-1", version: 1, divisionId: organization.id, canUpdate: false }]);
    const service = new MasterPlanQueryService({ query } as never, { listEnabled: jest.fn().mockResolvedValue([organization]) } as never);
    const scopedActor: MasterPlanActor = {
      ...actor([`${resource}:*:read`, `${resource}:*:export`, `${resource}:divisionId:read`]),
      tableDataScopes: [{ resource, scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: organization.id }] }]
    };

    expect(service.metadata(resource, scopedActor).fields).toEqual(expect.arrayContaining([expect.objectContaining({ key: "divisionId", editable: false })]));
    const result = await service.exportRows(resource, { filters: JSON.stringify({ divisionId: organization.pathLabel }) }, scopedActor);

    expect(result.rows).toEqual([expect.objectContaining({ divisionId: organization.id, divisionName: organization.pathLabel })]);
    expect(query.mock.calls.every(([, params]) => JSON.stringify(params).includes(organization.id))).toBe(true);
    expect(query.mock.calls.map(([sql]) => sql).join(" ")).toContain("division_id");
  });

  it("builds pending process rows from eligible tasks without inserting fake process reports", async () => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 0 }] : []);
    const resource = "mps-process-reports";
    const service = new MasterPlanQueryService({ query } as never, { listEnabled: jest.fn().mockResolvedValue([]) } as never);
    const result = await service.list(resource, { view: "PENDING" }, actor([`${resource}:*:read`, `${resource}:divisionId:read`]));
    const sql = query.mock.calls.map(([statement]) => String(statement)).join(" ");
    expect(result.rows).toEqual([]);
    expect(sql).toContain("FROM mps_weekly_process_plans task");
    expect(sql).not.toContain("INSERT INTO mps_process_reports");
  });
});

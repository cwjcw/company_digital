import { ForbiddenException } from "@nestjs/common";
import { auditPermissionFields, formatAuditActor } from "@kdos/contracts";
import { AuditActorIdentityResolver } from "../audit/audit-actor-identity.resolver";
import { FieldCandidateService, type CandidateContext } from "./field-candidate.service";
import { SqlFilterCompiler } from "./sql-filter.compiler";

const id = "04ada40c-21aa-496b-941c-8c4c969c477b";
const disabled = "0199e000-0000-7000-8000-000000000001";
const unknown = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const context: CandidateContext = {
  fields: auditPermissionFields, expressions: { createdBy: "record.created_by", updatedBy: "record.updated_by" },
  canReadField: () => true, scopedSource: "mps_process_reports record",
  scopedWhere: "record.tenant_id=$1 AND record.division_id=$2 AND record.production_date=$3",
  scopedParams: ["KAINAN", "division-4", "2026-10-11"]
};

describe("授权业务值优先的审计候选", () => {
  const query = jest.fn<Promise<Array<{id:string;username:string;displayName:string}>>, [string, unknown[]]>(async () => [{ id, username: "08977", displayName: "王家威" }, { id: disabled, username: "__kdos_system__", displayName: "KDOS系统任务" }]);
  const service = new FieldCandidateService({} as never, new AuditActorIdentityResolver({ query } as never));
  beforeEach(() => query.mockClear());

  it.each(["updatedBy", "createdBy"])("%s绕过member目录，保留停用/system/unknown以及真实原值", async (field) => {
    const memberCandidates = jest.fn(async () => []);
    const executor = jest.fn<Promise<Array<{value:string}>>, [string, unknown[]]>(async () => [id, disabled, "system", unknown].map(value => ({ value })));
    expect(await service.resolve(field, "", 50, { ...context, executor, memberCandidates })).toEqual([
      { value: id, label: "王家威" }, { value: disabled, label: "KDOS系统任务" }, { value: "system", label: "系统" }, { value: unknown, label: "未知用户" }
    ]);
    expect(memberCandidates).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0]![0]).toContain(context.scopedWhere);
    expect(executor.mock.calls[0]![1]).toEqual([...context.scopedParams, 51]);
  });

  it("姓名搜索能在第二个200值批次找到目标，不先截断目录，hasMore按匹配值判定", async () => {
    const first = Array.from({ length: 200 }, (_, i) => ({ value: `actor-${String(i).padStart(3, "0")}` }));
    const executor = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([{ value: id }]);
    expect(await service.resolveWithMeta("updatedBy", "王家威", 1, { ...context, executor })).toEqual({ options: [{ value: id, label: "王家威" }], hasMore: false });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(executor.mock.calls[1]![0]).toContain('COLLATE "C" > $4');
    expect(executor.mock.calls[1]![1]).toEqual([...context.scopedParams, "actor-199", 200]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("原UUID搜索返回姓名，不显示UUID；unknown可按标签搜索", async () => {
    const executor = async () => [{ value: id }, { value: unknown }];
    expect(await service.resolve("updatedBy", id, 50, { ...context, executor })).toEqual([{ value: id, label: "王家威" }]);
    expect(await service.resolve("updatedBy", "未知用户", 50, { ...context, executor })).toEqual([{ value: unknown, label: "未知用户" }]);
  });

  it("超过返回限制不静默声称全集", async () => {
    expect(await service.resolveWithMeta("updatedBy", "", 1, { ...context, executor: async () => [{ value: id }, { value: disabled }] })).toEqual({ options: [{ value: id, label: "王家威" }], hasMore: true });
  });

  it("没有可见记录不读取目录，无字段读权限也不查询", async () => {
    const executor = jest.fn(async () => []);
    expect(await service.resolve("updatedBy", "", 50, { ...context, executor })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
    executor.mockClear();
    await expect(service.resolve("updatedBy", "", 50, { ...context, executor, canReadField: () => false })).rejects.toBeInstanceOf(ForbiddenException);
    expect(executor).not.toHaveBeenCalled();
  });

  it("普通业务member仍调用原enabled-only provider，不能被审计resolver污染", async () => {
    const memberCandidates = jest.fn(async () => [{ value: id, label: "王家威" }]);
    const fields = [{ key: "owner", label: "负责人", type: "member" as const, editable: true }];
    expect(await service.resolve("owner", "", 50, { ...context, fields, expressions: { owner: "record.owner" }, memberCandidates, executor: async () => [{ value: id }, { value: disabled }] })).toEqual([{ value: id, label: "王家威" }]);
    expect(memberCandidates).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("标签选择提交原UUID，由唯一SQL编译器参数化比较原列", () => {
    const params = [...context.scopedParams];
    const sql = new SqlFilterCompiler(context.fields, context.expressions, () => true).compile({ logic: "AND", rules: [{ field: "updatedBy", operator: "eq", value: id }] }, params);
    expect(sql).toContain("record.updated_by::text =ANY($4::text[])");
    expect(params.at(-1)).toEqual([id]);
    expect(sql).not.toContain("王家威");
    expect(formatAuditActor(unknown)).toBe("未知用户");
  });
});

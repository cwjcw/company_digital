import { AuditActorIdentityResolver } from "./audit-actor-identity.resolver";
import { tablePermissionFieldsFor, isAuditActorField } from "@kdos/contracts";

const users = [
  { id: "04ada40c-21aa-496b-941c-8c4c969c477b", username: "08977", displayName: " 王家威 ", enabled: true },
  { id: "106dc309-f471-4959-a46b-5454089dcedd", username: "05989", displayName: "吴建修", enabled: true },
  { id: "9a846d7c-1605-4358-b4e4-617ef8f31dc9", username: "06359", displayName: "丁才春", enabled: true },
  { id: "b615038b-ba11-45ee-9175-d30bb599b77a", username: "06148", displayName: "李虹", enabled: true },
  { id: "c5d79e01-ef7e-4296-a874-0036bffa577d", username: "09417", displayName: "何辉", enabled: true },
  { id: "0199e000-0000-7000-8000-000000000001", username: "__kdos_system__", displayName: "KDOS系统任务", enabled: false },
  { id: "aaaaaaaa-0000-0000-0000-000000000001", username: "fallback", displayName: "   ", enabled: false }
];

describe("Audit Actor Identity resolver", () => {
  const query = jest.fn<Promise<typeof users>, [string, unknown[]]>(async () => users);
  const resolver = new AuditActorIdentityResolver({ query } as never);
  beforeEach(() => query.mockClear());

  it("批量解析五个启用用户、停用主体、空姓名、历史username和未知UUID，保留原值", async () => {
    const unknown = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const result = await resolver.resolve([...users.map(u => u.id), unknown, "system", "08977", "migration", "integration.worker"]);
    for (const user of users) expect(result.get(user.id)).toBe(user.displayName.trim() || user.username);
    expect(result.get("08977")).toBe("王家威");
    expect(result.get(unknown)).toBe("未知用户");
    expect(result.get("system")).toBe("系统");
    expect(result.get("migration")).toBe("migration");
    expect(result.get("integration.worker")).toBe("integration.worker");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).not.toMatch(/enabled|LIMIT/i);
  });

  it("空集合与只有system不查询目录", async () => {
    expect((await resolver.resolve([])).size).toBe(0);
    expect(await resolver.resolve(["system", "system"])).toEqual(new Map([["system", "系统"]]));
    expect(query).not.toHaveBeenCalled();
  });

  it("超过一批时有界批量解析，不逐行查询", async () => {
    const values = Array.from({ length: 1001 }, (_, index) => `worker-${index}`);
    expect((await resolver.resolve([...values, ...values])).size).toBe(1001);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("大写UUID仍能解析且映射保留原始value", async () => {
    expect((await resolver.resolve([users[0]!.id.toUpperCase()])).get(users[0]!.id.toUpperCase())).toBe("王家威");
  });

  it.each(["mps-process-reports", "mps-weekly-plans", "equipment-status-report", "supervision-tasks", "users"] as const)("%s两个审计字段具有正式format，普通member不被标记", (resource) => {
    const fields = tablePermissionFieldsFor(resource);
    expect(fields.filter(isAuditActorField).map(f => f.key)).toEqual(["createdBy", "updatedBy"]);
    expect(fields.filter(f => f.type === "member" && f.key !== "createdBy").every(f => !isAuditActorField(f))).toBe(true);
  });
});

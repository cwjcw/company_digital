import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { AdministratorGrant, AuditLog, User } from "../../entities";
import { AdministratorGrantApplicationService } from "./administrator-grant.application.service";

const actor = { userId: "00000000-0000-7000-8000-000000000001", username: "admin", name: "系统管理员", requestId: "request-1", isSystemAdmin: true };

function builder(current: AdministratorGrant | null) {
  return { setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(current) };
}

describe("AdministratorGrantApplicationService", () => {
  it("rejects mixed system and module administrator grants", async () => {
    const service = new AdministratorGrantApplicationService({} as never);
    await expect(service.replace("KAINAN", "user-1", { systemAdmin: true, moduleCodes: ["planning"] }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not remove the last system administrator", async () => {
    const current = { id: "grant-1", tenantId: "KAINAN", userId: "user-1", systemAdmin: true, moduleCodes: [], version: 3 } as unknown as AdministratorGrant;
    const manager = {
      findOneBy: jest.fn(async (entity) => entity === User ? ({ id: "user-1", enabled: true }) : null),
      createQueryBuilder: jest.fn(() => builder(current)), count: jest.fn().mockResolvedValue(1), query: jest.fn()
    };
    const dataSource = { transaction: jest.fn(async (work) => work(manager)) };
    const service = new AdministratorGrantApplicationService(dataSource as never);
    await expect(service.replace("KAINAN", "user-1", { systemAdmin: false, moduleCodes: ["planning"], expectedVersion: 3 }, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it("creates a module grant and audit record in one transaction", async () => {
    const save = jest.fn(async (entity, value) => entity === AdministratorGrant
      ? ({ id: "grant-2", ...value, version: 1 })
      : ({ id: "audit-1", ...value }));
    const manager = {
      findOneBy: jest.fn(async (entity) => entity === User ? ({ id: "user-2", enabled: true }) : null),
      createQueryBuilder: jest.fn(() => builder(null)), save, query: jest.fn()
    };
    const dataSource = { transaction: jest.fn(async (work) => work(manager)) };
    const service = new AdministratorGrantApplicationService(dataSource as never);
    await expect(service.replace("KAINAN", "user-2", { moduleCodes: ["planning", "marketing"], expectedVersion: null }, actor))
      .resolves.toMatchObject({ userId: "user-2", grant: { systemAdmin: false, moduleCodes: ["planning", "marketing"] } });
    expect(save).toHaveBeenCalledWith(AdministratorGrant, expect.objectContaining({ tenantId: "KAINAN", userId: "user-2", moduleCodes: ["planning", "marketing"] }));
    expect(save).toHaveBeenCalledWith(AuditLog, expect.objectContaining({ resource: "administrators", action: "administrator_grant.replaced" }));
  });

  it("lets ordinary system administrators manage modules but not system administrators", async () => {
    const manager = {
      findOneBy: jest.fn(async (entity) => entity === User ? ({ id: "user-2", username: "member", enabled: true }) : null),
      createQueryBuilder: jest.fn(() => builder(null)), save: jest.fn(async (_entity, value) => ({ id: "grant-2", ...value })), query: jest.fn()
    };
    const service = new AdministratorGrantApplicationService({ transaction: jest.fn(async (work) => work(manager)) } as never);
    const systemAdministrator = { ...actor, username: "system-manager" };
    await expect(service.replace("KAINAN", "user-2", { moduleCodes: ["planning"], expectedVersion: null }, systemAdministrator)).resolves.toBeDefined();
    await expect(service.replace("KAINAN", "user-2", { systemAdmin: true, expectedVersion: null }, systemAdministrator)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.replace("KAINAN", "user-2", { moduleCodes: ["planning"], expectedVersion: null }, { ...actor, username: "module-manager", isSystemAdmin: false }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});

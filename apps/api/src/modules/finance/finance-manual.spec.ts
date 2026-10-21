import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { financeCustomerCreateFieldAllowed, FINANCE_CUSTOMER_RESOURCE as resource } from "@kdos/contracts";
import { FinanceApplicationService } from "./finance.application.service";
import { financeScope, type FinanceActor } from "./finance.types";
import type { FinanceRepository } from "./finance.repository";

const admin: FinanceActor = { tenantId: "KAINAN", userId: "0199ea00-0000-7000-8000-000000000001", username: "Synthetic admin", requestId: "test", permissions: ["*"] };
const reader: FinanceActor = { ...admin, permissions: [`${resource}:*:read`, `${resource}:*:create`, `${resource}:customerCode:read`, `${resource}:departmentCategory:read`, `${resource}:salesChannel:read`] };
const input = { customerCode: "SYNTHETIC-1/2", departmentCategory: "业务一部", salesChannel: "内销" };
const setup = () => { const repository = { transaction: jest.fn() }; return { repository, service: new FinanceApplicationService(repository as unknown as FinanceRepository) }; };

describe("Manual finance customer authorization and input boundary", () => {
    it("requires create, independently of read/update/import or another module's administration", async () => {
        const { service, repository } = setup();
        for (const permissions of [[`${resource}:*:read`], [`${resource}:*:update`], [`${resource}:*:import`], []]) {
            await expect(service.createManual(input, { ...admin, permissions, moduleAdminCodes: ["planning"] })).rejects.toThrow("新增权限");
        }
        expect(repository.transaction).not.toHaveBeenCalled();
    });
    it.each([null, [], { customerCode: " " }, { customerCode: 123 }, { customerCode: "x".repeat(129) },
        { ...input, source: "INITIAL_IMPORT" }, { ...input, tenantId: "OTHER" }, { ...input, createdBy: admin.userId },
        { ...input, version: 1 }, { ...input, id: admin.userId }, { ...input, departmentCategory: "事业一部" }, { ...input, salesChannel: "国内" }])("rejects malformed or spoofed input %p", async value => {
        const { service, repository } = setup();
        await expect(service.createManual(value as never, admin)).rejects.toThrow(BadRequestException);
        expect(repository.transaction).not.toHaveBeenCalled();
    });
    it("checks each supplied field, including the read-only customer identity on creation", async () => {
        const { service, repository } = setup();
        for (const field of ["customerCode", "departmentCategory", "salesChannel"]) {
            await expect(service.createManual(input, { ...reader, permissions: reader.permissions.filter(permission => permission !== `${resource}:${field}:read`) })).rejects.toThrow(ForbiddenException);
        }
        expect(repository.transaction).not.toHaveBeenCalled();
    });
    it("permits the ADD_VIEW_ALL form without granting updates to existing records", () => {
        expect(financeCustomerCreateFieldAllowed(reader, "departmentCategory")).toBe(true);
        expect(reader.permissions.includes(`${resource}:*:update`)).toBe(false);
        expect(financeCustomerCreateFieldAllowed(reader, "createdBy")).toBe(false);
    });
    it("allows ADD_ONLY capture without giving read or bypassing arbitrary hidden-field policies", () => {
        const addOnly = { permissions: [`${resource}:*:create`], tableDataScopes: [{ resource, scope: "NONE", actions: ["create"] }] };
        expect(financeCustomerCreateFieldAllowed(addOnly, "customerCode")).toBe(true);
        expect(financeCustomerCreateFieldAllowed({ ...addOnly, tableDataScopes: [{ resource, scope: "ALL", actions: ["create"] }] }, "customerCode")).toBe(false);
    });
    it("rejects missing tenant/actor before any transaction", async () => {
        const { service, repository } = setup();
        for (const actor of [{ ...admin, userId: null }, { ...admin, tenantId: "" }]) await expect(service.createManual(input, actor)).rejects.toThrow(ForbiddenException);
        expect(repository.transaction).not.toHaveBeenCalled();
    });
    it("denies an entire CUSTOM alternative containing unknown organization/prototype rules", () => {
        for (const fieldKey of ["divisionId", "tenantId", "toString"]) {
            const actor = { ...reader, tableDataScopes: [{ resource, scope: "CUSTOM", actions: ["create"], rules: [{ fieldKey: "customerCode", operator: "EQ", value: input.customerCode }, { fieldKey, operator: "EQ", value: "X" }] }] };
            expect(financeScope(actor, [], "create")).toBe("1=0");
        }
    });
});

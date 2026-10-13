import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { financeCustomerMinimumSourceDate, tablePermissionFieldsFor, tableFilterResourceCapabilities } from "@kdos/contracts";
import { FinanceApplicationService, normalizeFinanceRows, financeClassification } from "./finance.application.service";
import { financeAuthorize, financeScope, type FinanceActor } from "./finance.types";
import { FinanceFilterSourceProvider } from "./finance.filter-sources";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import type { FinanceRepository } from "./finance.repository";
import { readFileSync } from "node:fs";
import path from "node:path";
const admin: FinanceActor = { tenantId: "KAINAN", userId: "0199e000-0000-7000-8000-000000000001", username: "fixture", requestId: "test", permissions: ["*"] };
const resource = "finance-customer-mappings";
describe("Independent finance customer classifications", () => {
    it("checks the exact 138-row business seed and sensitive code suffixes", () => {
        const lines = readFileSync(path.resolve(__dirname, "../../../../../automation/finance_customer_sync/seeds/finance_customer_mapping_seed.csv"), "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
        expect(lines.shift()).toBe("客户编号,部门类别,内外区分");
        const rows = lines.map(l => l.split(","));
        expect(rows).toHaveLength(138);
        expect(new Set(rows.map(r => r[0])).size).toBe(138);
        expect(rows.find(r => r[0] === "A140")).toEqual(["A140", "业务一部", "内销"]);
        for (const [dept, total] of [["业务一部", 83], ["业务二部", 7], ["业务三部", 48]])
            expect(rows.filter(r => r[1] === dept)).toHaveLength(total as number);
        expect(rows.filter(r => r[2] === "内销")).toHaveLength(49);
        expect(rows.filter(r => r[2] === "外销")).toHaveLength(89);
        for (const code of ["A097-A", "A097-B", "A097-E", "A108", "A108A", "C031", "C031-A", "C031-B", "C031-C", "C031-LP"])
            expect(rows.some(r => r[0] === code)).toBe(true);
    });
    it("normalizes edges only and skips exact duplicates", () => { const result = normalizeFinanceRows([{ customerCode: " 001-A " }, { customerCode: "001-A" }, { customerCode: "001 A" }].map(row => ({...row,createdAtSource:financeCustomerMinimumSourceDate+"T00:00:00"})), "E10_SYNC"); expect(result.read).toBe(3); expect(result.rows).toHaveLength(2); expect(result.rows.every(r => r.departmentCategory === null && r.salesChannel === null)).toBe(true); });
    it("accepts either new creation or an old customer's later modification", () => {
        for (const dates of [{createdAtSource:financeCustomerMinimumSourceDate+"T00:00:00",modifiedAtSource:null},{createdAtSource:"2020-01-01T00:00:00",modifiedAtSource:financeCustomerMinimumSourceDate+"T10:00:00.0000001"}]) expect(normalizeFinanceRows([{customerCode:"NEW",...dates}],"E10_SYNC").rows).toHaveLength(1);
    });
    it("rejects both dates before the cutoff, missing dates and UTC reinterpretation", () => {
        for (const dates of [{createdAtSource:"2026-10-11T23:59:59",modifiedAtSource:"2026-10-11T23:59:59"},{createdAtSource:null,modifiedAtSource:null},{createdAtSource:financeCustomerMinimumSourceDate+"T00:00:00Z"},{createdAtSource:"2026-02-30T00:00:00"}]) expect(()=>normalizeFinanceRows([{customerCode:"OLD",...dates}],"E10_SYNC")).toThrow(BadRequestException);
    });
    it.each([0, null, "", {}, [{ customerCode: 140 }], [{ customerCode: " " }], [{ customerCode: "A", tenantId: "OTHER" }], [{ customerCode: "A", salesChannel: "内销" }]])("rejects malformed/spoofed upstream input %p", value => { expect(() => normalizeFinanceRows(value, "E10_SYNC")).toThrow(BadRequestException); });
    it("accepts an empty source without deleting mappings", () => expect(normalizeFinanceRows([], "E10_SYNC")).toEqual({ rows: [], read: 0 }));
    it("rejects conflicting seed duplicate classifications", () => expect(() => normalizeFinanceRows([{ customerCode: "A", salesChannel: "内销" }, { customerCode: "A", salesChannel: "外销" }], "INITIAL_IMPORT")).toThrow("分类冲突"));
    it.each(["业务一部", "业务二部", "业务三部", "业务四部", null, ""])("accepts department category %p", v => expect(financeClassification(v, "departmentCategory")).toBe(v || null));
    it("rejects invalid classifications", () => { expect(() => financeClassification("事业一部", "departmentCategory")).toThrow(); expect(() => financeClassification("国内", "salesChannel")).toThrow(); });
    it("denies unrelated administrators and no-scope readers", () => { const a = { ...admin, permissions: [`${resource}:*:read`], moduleAdminCodes: ["planning"] }; expect(() => financeAuthorize({ ...a, permissions: [] })).toThrow(ForbiddenException); expect(financeScope(a, [])).toBe("1=0"); });
    it("reuses typed metadata, shared scopes, and tenant transaction for filter/export", () => { const registry = new TableFilterRegistry(); const repo = { query: jest.fn() }; new FinanceFilterSourceProvider(registry, repo as unknown as FinanceRepository).onModuleInit(); const source = registry.get(resource); expect(source.table).toBe("finance_customer_mappings"); expect(tableFilterResourceCapabilities[resource].status).toBe("REGISTERED_AND_FILTERABLE"); expect(tablePermissionFieldsFor(resource).slice(0, 3).map(f => f.label)).toEqual(["客户编号", "部门类别", "内外区分"]); expect(tablePermissionFieldsFor(resource)[0].editable).toBe(false); const params: unknown[] = ["KAINAN"]; expect(source.buildScope({ ...admin, permissions: [`${resource}:*:read`], tableDataScopes: [{ resource, scope: "OWN", actions: ["read"] }] }, params)).toContain("created_by"); expect(params).toHaveLength(2); source.runQuery!("SQL", ["KAINAN"]); expect(repo.query).toHaveBeenCalledWith("SQL", ["KAINAN"]); });
    it("blocks readonly users before entering a write transaction", async () => { const repo = { transaction: jest.fn() }; const service = new FinanceApplicationService(repo as unknown as FinanceRepository); await expect(service.update("id", { salesChannel: "内销", expectedVersion: 1 }, { ...admin, permissions: [`${resource}:*:read`] })).rejects.toThrow(ForbiddenException); expect(repo.transaction).not.toHaveBeenCalled(); });
    it("blocks immutable/technical fields and invalid versions", async () => { const repo = { transaction: jest.fn() }; const service = new FinanceApplicationService(repo as unknown as FinanceRepository); for (const input of [{ customerCode: "A", expectedVersion: 1 }, { tenantId: "OTHER", expectedVersion: 1 }, { createdBy: admin.userId, expectedVersion: 1 }, { departmentCategory: "业务一部", expectedVersion: 0 }])
        await expect(service.update("id", input, admin)).rejects.toThrow(BadRequestException); expect(repo.transaction).not.toHaveBeenCalled(); });
});

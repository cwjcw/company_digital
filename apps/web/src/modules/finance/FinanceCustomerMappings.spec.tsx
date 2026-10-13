import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { api } from "../../api";
import { FinanceCustomerMappings } from "./FinanceCustomerMappings";
import { tablePermissionFieldsFor } from "@kdos/contracts";
vi.mock("../../api", async (original) => ({ ...await original<object>(), api: vi.fn() }));
vi.mock("../../shared/audit-fields", () => ({ useAuditColumns: () => [] }));
vi.mock("../../shared/KdosDataTable", async (original) => ({ ...await original<object>(), KdosDataTable: ({ resource, columns, serverData, selectionActions, contextFilterGroup, toolbar }: any) => <div>
  <div>{resource}</div>{columns.map((c: any) => <span key={c.dataIndex}>{c.title}</span>)}{toolbar}
  <pre data-testid="filter">{JSON.stringify(contextFilterGroup)}</pre>
  {selectionActions({ selectedRows: [row], selectedRowKeys: [row.id] })}
  <button onClick={() => serverData.onQueryChange({ page: 2, pageSize: 50, search: "A140", filters: {}, filterGroup: contextFilterGroup })}>查询下一页</button>
    </div> }));
const r = "finance-customer-mappings";
const row = { id: "0199e000-0000-7000-8000-000000000002", version: 7, customerCode: "A140", departmentCategory: "业务一部", salesChannel: "内销" };
const viewer = { permissions: [`${r}:*:read`, ...tablePermissionFieldsFor(r).map(f => `${r}:${f.key}:read`)] };
function mount(user: any = { permissions: ["*"] }) { localStorage.setItem("sessionUser", JSON.stringify(user)); return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><FinanceCustomerMappings /></QueryClientProvider>); }
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(api).mockImplementation(async (p) => p.includes("summary") ? { total: 609, pending: 471, lastSync: { completedAt: "2026-10-13T01:00:00+08:00", created: 471 } } as never : { rows: [row], total: 609 } as never); });
afterEach(cleanup);
describe("Finance customer mapping UI", () => {
    it("shows three business fields, totals and no duplicate finance-management header", async () => { mount(); await screen.findByText("客户总数 609"); expect(screen.getByText("待分类 471")).toBeVisible(); for (const label of ["客户编号", "部门类别", "内外区分"])
        expect(screen.getByText(label)).toBeVisible(); expect(screen.queryByText("财务管理")).toBeNull(); });
    it("keeps readonly viewers readonly", async () => { mount(viewer); await screen.findByText("客户总数 609"); expect(screen.queryByRole("button", { name: "修改分类" })).toBeNull(); });
    it("does not query finance data for an unauthorized or unrelated module administrator", () => { mount({ permissions: [], moduleAdminCodes: ["planning"] }); expect(screen.getByText("当前权限组不能查看客户对应表")).toBeVisible(); expect(api).not.toHaveBeenCalled(); });
    it("passes pending through the same typed FilterGroup and requests server pagination", async () => { mount(); await screen.findByText("客户总数 609"); fireEvent.click(screen.getByRole("switch", { name: "仅查看待分类" })); await waitFor(() => expect(screen.getByTestId("filter")).toHaveTextContent('"logic":"OR"')); fireEvent.click(screen.getByText("查询下一页")); await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining("page=2"))); const p = vi.mocked(api).mock.calls.find(([p]) => p.includes("page=2"))![0]; expect(p).toContain("pageSize=50"); expect(p).toContain("search=A140"); expect(new URLSearchParams(p.split("?")[1]).get("filterGroup")).toContain("is_empty"); });
    it("saves only the two classifications with the original expectedVersion", async () => { mount(); await screen.findByText("客户总数 609"); fireEvent.click(screen.getByRole("button", { name: "修改分类" })); expect(screen.getByDisplayValue("A140")).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: /保\s*存/ })); await waitFor(() => expect(api).toHaveBeenCalledWith(`/finance/customer-mappings/${row.id}`, expect.objectContaining({ method: "PATCH" }))); const input = vi.mocked(api).mock.calls.find(([, v]) => v?.method === "PATCH")![1]; expect(JSON.parse(input!.body as string)).toEqual({ expectedVersion: 7, departmentCategory: "业务一部", salesChannel: "内销" }); });
    it("preserves the modal draft and concrete reason on a 409/error", async () => { vi.mocked(api).mockImplementation(async (p, options) => { if (options?.method === "PATCH")
        throw new Error("客户分类已被其他人员修改，请刷新后重试"); return (p.includes("summary") ? { total: 609, pending: 471, lastSync: null } : { rows: [row], total: 609 }) as never; }); mount(); await screen.findByText("客户总数 609"); fireEvent.click(screen.getByRole("button", { name: "修改分类" })); fireEvent.click(screen.getByRole("button", { name: /保\s*存/ })); await screen.findByText("客户分类已被其他人员修改，请刷新后重试"); await waitFor(() => expect(screen.getByDisplayValue("A140")).toBeVisible()); });
    it("hides pending queries when classification fields are unreadable", async () => { mount({ permissions: [`${r}:*:read`, `${r}:customerCode:read`] }); await screen.findByText("客户总数 609"); expect(screen.queryByRole("switch")).toBeNull(); });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrintSettingsPreview } from "./table-print-settings";
import { api } from "../api";
import type { TablePrintDto, TablePrintRequest } from "./table-print";
vi.mock("../api", () => ({ api: vi.fn() }));
const dto: TablePrintDto = {
  resource: "projects", title: "项目管理", columns: [
    { key: "name", label: "项目名称", align: "left", width: 20 }, { key: "number", label: "项目编号", align: "left", width: 12 }, { key: "remark", label: "备注", align: "left", width: 22 }
  ], headerGroups: [], rows: [{ name: "测试项目", number: "P1", remark: "长备注" }],
  meta: { rangeType: "FILTERED", total: 1, printedCount: 1, orientation: "portrait", filtered: false, searched: false, printedAt: "2026-10-30T00:00:00Z", printedBy: "测试员" }
};
const request: TablePrintRequest = { resource: "projects", rangeType: "FILTERED", columnKeys: ["number", "name"], viewKey: "main" };
let stored = new Map<string, unknown>();
let failSave = false;
function prefKey(resource: string, view: string | undefined, type: string) { return `${resource}:${view ?? ""}:${type}`; }
const fieldList = () => screen.getByRole("list", { name: "打印字段" });
const chosen = () => [...fieldList().querySelectorAll<HTMLInputElement>('.kdos-print-field-title input:checked')].map(input => input.closest("li")!.getAttribute("data-field-key"));
const mount = (override: Partial<TablePrintRequest> = {}) => { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}><PrintSettingsPreview dto={dto} request={{ ...request, ...override }} onClose={vi.fn()} /></QueryClientProvider>); };
beforeEach(() => { localStorage.clear(); stored = new Map(); failSave = false; vi.clearAllMocks(); vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
  if (path === "/auth/preferences/table-config" && init?.method === "PUT") {
    if (failSave) throw new Error("服务暂时异常");
    const body = JSON.parse(String(init.body)); const key = prefKey(body.resource, body.viewKey, body.configType);
    if (body.config === null) stored.delete(key); else stored.set(key, body.config);
    return { config: body.config, reset: body.config === null } as never;
  }
  if (path.startsWith("/auth/preferences/table-config?")) {
    const params = new URL(path, "http://local").searchParams;
    return { config: stored.get(prefKey(params.get("resource") ?? "", params.get("viewKey") ?? undefined, params.get("configType") ?? "")) ?? null } as never;
  }
  return dto as never;
}); vi.spyOn(window, "print").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("shared print settings", () => {
  it("defaults to all authorized printable fields independently of the page's visible fields", async () => {
    stored.set(prefKey("projects", "main", "DISPLAY"), { version: 1, visibleFieldKeys: ["name"] });
    mount(); await waitFor(() => expect(chosen()).toEqual(["name", "number", "remark"]));
    fireEvent.click(within(fieldList()).getByRole("checkbox", { name: "备注" }));
    fireEvent.click(within(fieldList()).getByRole("checkbox", { name: "项目名称" }));
    expect(chosen()).toEqual(["number"]);
    expect(stored.get(prefKey("projects", "main", "DISPLAY"))).toEqual({ version: 1, visibleFieldKeys: ["name"] });
    expect(stored.has(prefKey("projects", "main", "PRINT"))).toBe(false);
  });
  it("drag/drop order, numeric mm width, paper and orientation settings take effect; oversized custom layout blocks print", async () => {
    mount(); await screen.findByLabelText("纸张大小");
    const source = fieldList().querySelector('[data-field-key="name"]')!;
    const target = fieldList().querySelector('[data-field-key="number"]')!;
    fireEvent.drop(target, { dataTransfer: { getData: () => source.getAttribute("data-field-key") } });
    expect(chosen()).toEqual(["name", "number", "remark"]);
    fireEvent.change(screen.getByLabelText("纸张大小"), { target: { value: "A3" } });
    fireEvent.change(screen.getByLabelText("打印方向"), { target: { value: "landscape" } });
    fireEvent.change(screen.getByLabelText("项目名称列宽（毫米）"), { target: { value: "450" } });
    expect(screen.getByRole("alert")).toHaveTextContent("超过可用宽度 400 mm");
    expect(screen.getByRole("button", { name: "本次打印" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("列宽适配"), { target: { value: "fit" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "本次打印" })).toBeEnabled());
  });
  it("saves only when requested, restores on reopen, isolates view/resource and resets to system defaults", async () => {
    const first = mount(); await screen.findByLabelText("纸张大小");
    fireEvent.change(screen.getByLabelText("纸张大小"), { target: { value: "A3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存为我的默认配置" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存")); first.unmount();
    const second = mount(); await waitFor(() => expect(screen.getByLabelText("纸张大小")).toHaveValue("A3")); second.unmount();
    for (const override of [{ resource: "tasks" }, { viewKey: "other" }]) {
      const other = mount(override); await waitFor(() => expect(screen.getByLabelText("纸张大小")).toHaveValue("A4")); other.unmount();
    }
    mount(); await screen.findByLabelText("纸张大小"); fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() => expect(screen.getByLabelText("纸张大小")).toHaveValue("A4")); expect(chosen()).toEqual(["name", "number", "remark"]);
  });
  it("invalid saved fields are removed and never expand access beyond the current print DTO", async () => {
    stored.set(prefKey("projects", "main", "PRINT"), { version: 1, columnKeys: ["removed", "password"], widths: {}, paperSize: "A3" });
    mount(); await waitFor(() => expect(chosen()).toEqual([])); expect(screen.getByRole("alert")).toHaveTextContent("至少选择一个");
    expect(screen.getByRole("button", { name: "本次打印" })).toBeDisabled();
  });
  it("reports server save failure clearly", async () => {
    mount(); await waitFor(() => expect(screen.getByRole("button", { name: "保存为我的默认配置" })).toBeEnabled());
    failSave = true;
    fireEvent.click(screen.getByRole("button", { name: "保存为我的默认配置" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("服务暂时异常"));
  });
  it("rechecks server authorization before printing, removes revoked fields and requests review instead of printing", async () => {
    mount(); await waitFor(() => expect(screen.getByRole("button", { name: "本次打印" })).toBeEnabled());
    vi.mocked(api).mockResolvedValue({ ...dto, columns: dto.columns.filter(c => c.key !== "name"), rows: [{ number: "P1" }] });
    fireEvent.click(screen.getByRole("button", { name: "本次打印" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("字段权限已变化"));
    expect(window.print).not.toHaveBeenCalled(); expect(chosen()).toEqual(["number", "remark"]);
  });
  it("printing uses all refreshed rows and trusted metadata and never implicitly saves preferences", async () => {
    mount(); await waitFor(() => expect(screen.getByRole("button", { name: "本次打印" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "本次打印" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(api).mock.calls.find(([path]) => path === "/table-prints/render")![1]!.body));
    expect(body.rangeType).toBe("FILTERED"); expect(body.resource).toBe("projects");
    expect(stored.size).toBe(0);
  });
});

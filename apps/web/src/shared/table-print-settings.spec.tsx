import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printPreferenceKey } from "@kdos/contracts";
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
const request: TablePrintRequest = { resource: "projects", rangeType: "FILTERED", columnKeys: ["number", "name"], viewKey: "main", preferenceScope: { tenantKey: "t", userKey: "u" } };
const key = printPreferenceKey("t", "u", "projects", "main");
const fieldList = () => screen.getByRole("list", { name: "打印字段" });
const chosen = () => [...fieldList().querySelectorAll<HTMLInputElement>('.kdos-print-field-title input:checked')].map(input => input.closest("li")!.getAttribute("data-field-key"));
const mount = (override: Partial<TablePrintRequest> = {}) => render(<PrintSettingsPreview dto={dto} request={{ ...request, ...override }} onClose={vi.fn()} />);
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(api).mockResolvedValue(dto); vi.spyOn(window, "print").mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("shared print settings", () => {
  it("defaults to actual visible business columns in order and can add/remove hidden authorized fields without changing table preferences", () => {
    localStorage.setItem("kdos-form-view:t:u:projects", '["name"]');
    mount(); expect(chosen()).toEqual(["number", "name"]);
    fireEvent.click(within(fieldList()).getByRole("checkbox", { name: "备注" }));
    fireEvent.click(within(fieldList()).getByRole("checkbox", { name: "项目名称" }));
    expect(chosen()).toEqual(["number", "remark"]);
    expect(localStorage.getItem("kdos-form-view:t:u:projects")).toBe('["name"]');
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("drag/drop order, numeric mm width, paper and orientation settings take effect; oversized custom layout blocks print", async () => {
    mount();
    const source = fieldList().querySelector('[data-field-key="name"]')!;
    const target = fieldList().querySelector('[data-field-key="number"]')!;
    fireEvent.drop(target, { dataTransfer: { getData: () => source.getAttribute("data-field-key") } });
    expect(chosen()).toEqual(["name", "number"]);
    fireEvent.change(screen.getByLabelText("纸张大小"), { target: { value: "A3" } });
    fireEvent.change(screen.getByLabelText("打印方向"), { target: { value: "landscape" } });
    fireEvent.change(screen.getByLabelText("项目名称列宽（毫米）"), { target: { value: "450" } });
    expect(screen.getByRole("alert")).toHaveTextContent("超过可用宽度 400 mm");
    expect(screen.getByRole("button", { name: "本次打印" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("列宽适配"), { target: { value: "fit" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "本次打印" })).toBeEnabled());
  });
  it("saves only when requested, restores on reopen, isolates all scopes and resets to system defaults", () => {
    const first = mount();
    fireEvent.change(screen.getByLabelText("纸张大小"), { target: { value: "A3" } });
    fireEvent.click(screen.getByRole("button", { name: "保存为我的默认配置" }));
    expect(screen.getByRole("status")).toHaveTextContent("已保存"); first.unmount();
    const second = mount(); expect(screen.getByLabelText("纸张大小")).toHaveValue("A3"); second.unmount();
    for (const override of [{ preferenceScope: { tenantKey: "other", userKey: "u" } }, { preferenceScope: { tenantKey: "t", userKey: "other" } }, { resource: "tasks" }, { viewKey: "other" }]) {
      const other = mount(override); expect(screen.getByLabelText("纸张大小")).toHaveValue("A4"); other.unmount();
    }
    mount(); fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(screen.getByLabelText("纸张大小")).toHaveValue("A4"); expect(chosen()).toEqual(["number", "name"]);
  });
  it("invalid saved fields do not expand to all fields, and empty selection blocks printing/saving", () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, columnKeys: ["removed", "password"], widths: {}, paperSize: "A3" }));
    mount(); expect(chosen()).toEqual([]); expect(screen.getByRole("alert")).toHaveTextContent("至少选择一个");
    expect(screen.getByRole("button", { name: "本次打印" })).toBeDisabled();
  });
  it("reports storage failure and handles malformed session safely", () => {
    localStorage.setItem("sessionUser", 'broken');
    mount(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "保存为我的默认配置" }));
    expect(screen.getByRole("status")).toHaveTextContent("保存失败");
  });
  it("rechecks server authorization before printing, removes revoked fields and requests review instead of printing", async () => {
    mount(); await waitFor(() => expect(screen.getByRole("button", { name: "本次打印" })).toBeEnabled());
    vi.mocked(api).mockResolvedValue({ ...dto, columns: dto.columns.filter(c => c.key !== "name"), rows: [{ number: "P1" }] });
    fireEvent.click(screen.getByRole("button", { name: "本次打印" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("字段权限已变化"));
    expect(window.print).not.toHaveBeenCalled(); expect(chosen()).toEqual(["number"]);
  });
  it("printing uses all refreshed rows and trusted metadata and never implicitly saves preferences", async () => {
    mount(); await waitFor(() => expect(screen.getByRole("button", { name: "本次打印" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "本次打印" }));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(vi.mocked(api).mock.calls.find(([path]) => path === "/table-prints/render")![1]!.body));
    expect(body.rangeType).toBe("FILTERED"); expect(body.resource).toBe("projects");
    expect(localStorage.getItem(key)).toBeNull();
  });
});

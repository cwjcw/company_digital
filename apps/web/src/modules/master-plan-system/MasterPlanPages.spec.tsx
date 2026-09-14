import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { MasterPlanResourcePage } from "./MasterPlanPages";

vi.mock("../../api", () => ({ api: vi.fn() }));

describe("MasterPlanResourcePage create feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", permissions: ["*"], isSystemAdmin: true }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) {
        const fields = tablePermissionFieldsFor("mps-shipping-plans");
        return { resource: "mps-shipping-plans", fields, createFields: fields.filter((field) => field.editable), actions: { create: true, update: true, delete: true, import: true, export: true, batchUpdate: true } } as never;
      }
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?")) return { rows: [], total: 0 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("shows a concrete validation error instead of silently ignoring confirm", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole("button", { name: /新\s*增/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /OK|确\s*定/ }));

    await waitFor(() => expect(screen.getAllByText("请填写客户编码").length).toBeGreaterThan(0));
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(dialog).toBeInTheDocument();
  }, 15_000);

  it("patches only the changed cell with expectedVersion after edit mode is entered", async () => {
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/master-plan-system/references/organizations") || path === "/directory/users") return [] as never;
      if (path.endsWith("/meta")) {
        const fields = tablePermissionFieldsFor("mps-shipping-plans");
        return { resource: "mps-shipping-plans", fields, createFields: fields.filter((field) => field.editable), actions: { create: true, update: true, delete: true, import: true, export: true, batchUpdate: true } } as never;
      }
      if (path.startsWith("/master-plan-system/resources/mps-shipping-plans?") && !init) return { rows: [{ id: "row-1", version: 4, itemName: "旧品项名称", canUpdate: true }], total: 1 } as never;
      if (path === "/master-plan-system/resources/mps-shipping-plans/row-1" && init?.method === "PATCH") return { version: 5 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MasterPlanResourcePage resource="mps-shipping-plans" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /进入\s*编辑模式/ }));
    const input = await screen.findByDisplayValue("旧品项名称"); fireEvent.change(input, { target: { value: "新品项名称" } }); fireEvent.blur(input);
    await waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith("/master-plan-system/resources/mps-shipping-plans/row-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ itemName: "新品项名称", expectedVersion: 4 }) })));
    expect(await screen.findByDisplayValue("新品项名称")).toBeInTheDocument();
  }, 15_000);
});

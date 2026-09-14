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
      if (path === "/planning/organization-options" || path === "/directory/users") return [] as never;
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
});

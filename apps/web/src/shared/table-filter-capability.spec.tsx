import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../api";
import { KdosDataTable } from "./KdosDataTable";

vi.mock("../api", () => ({ api: vi.fn() }));

const field = { key: "equipmentCode", label: "设备编号", type: "text", editable: true } as TablePermissionFieldDefinition;
const column = { title: "设备编号", dataIndex: "equipmentCode", key: "equipmentCode" };

function renderTable(resource: string, withFields = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <KdosDataTable resource={resource} {...(withFields ? { filterFields: [field] } : {})} columns={[column]} dataSource={[{ id: "1", equipmentCode: "EQ-1" }]} />
  </QueryClientProvider>);
}

describe("KN-FILTER-001 typed filtering capability", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); localStorage.setItem("sessionUser", JSON.stringify({ sub: "u1", permissions: ["*"] })); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("shows the platform advanced filter for a registered resource", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => path === "/table-filters/resources"
      ? [{ code: "mps-process-reports", filterableFields: ["processCode"] }] as never
      : [] as never);
    renderTable("mps-process-reports");
    expect(await screen.findByRole("button", { name: /高级筛选/ })).toBeEnabled();
  });

  it("never offers an editable-but-ignored filter for an unregistered resource", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => path === "/table-filters/resources"
      ? [{ code: "mps-process-reports", filterableFields: ["processCode"] }] as never
      : [] as never);
    renderTable("equipment-register");
    const disabled = await screen.findByRole("button", { name: /高级筛选（暂不支持）/ });
    expect(disabled).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole("button", { name: /^高级筛选$/ })).not.toBeInTheDocument());
  });

  it("uses the contract field metadata by default so pages do not have to pass filterFields", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => path === "/table-filters/resources"
      ? [{ code: "equipment-register", filterableFields: ["equipmentCode", "equipmentName"] }] as never
      : [] as never);
    renderTable("equipment-register", false);
    /* 页面未显式传 filterFields 时，仍按契约 metadata 判定已接入并给出正式高级筛选。 */
    const triggers = await screen.findAllByRole("button", { name: /高级筛选/ });
    expect(triggers.some((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("falls back to the disabled notice when the resource is not registered", async () => {
    vi.mocked(api).mockImplementation(async () => [] as never);
    renderTable("users", false);
    expect(await screen.findByRole("button", { name: /高级筛选（暂不支持）/ })).toBeDisabled();
  });
});

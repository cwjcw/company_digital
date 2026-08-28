import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { HrDepartureCheckPage } from "./HumanResourcesPages";

vi.mock("../../api", () => ({ api: vi.fn() }));
const mockedApi = vi.mocked(api);

describe("HrDepartureCheckPage", () => {
  beforeEach(() => {
    cleanup(); mockedApi.mockReset();
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "hr-user", permissions: ["hr-departure-check:*:read", "hr-departure-check:*:create"] }));
  });

  it("manually adds an account and displays the directory comparison result", async () => {
    mockedApi.mockImplementation(async (path) => path === "/directory/users" ? [] : { row: { account: "05504", name: "李婷", status: "入职" } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AntApp><HrDepartureCheckPage /></AntApp></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /手工新增/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "账号" }), { target: { value: "05504" } });
    fireEvent.change(screen.getByRole("textbox", { name: "姓名" }), { target: { value: "李婷" } });
    fireEvent.click(screen.getByRole("button", { name: "新增并检查" }));
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith("/hr/departure-check/manual", expect.objectContaining({ method: "POST", body: JSON.stringify({ account: "05504", name: "李婷" }) })));
    expect(await screen.findByText("05504")).toBeInTheDocument();
    expect(screen.getByText("李婷")).toBeInTheDocument();
    expect(screen.getAllByText("入职").length).toBeGreaterThan(0);
  });
});

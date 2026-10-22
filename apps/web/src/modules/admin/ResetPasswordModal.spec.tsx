import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { ResetPasswordModal } from "./ResetPasswordModal";

vi.mock("../../api", () => ({ api: vi.fn() }));
const user = { id: "employee", username: "demo001", displayName: "测试成员", version: 3 };
const result = { id: "employee", reset: true, mustChangePassword: true, version: 4 };
describe("manual administrator password reset confirmation", () => {
  beforeEach(() => { vi.mocked(api).mockReset(); });
  afterEach(cleanup);
  it("identifies the account and default password, and cancel never submits", async () => {
    const onClose = vi.fn(); render(<ResetPasswordModal user={user} onClose={onClose} onReset={vi.fn()} />);
    expect(screen.getByText(/demo001/)).toBeInTheDocument(); expect(screen.getByText("默认密码：kn123456")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ })); expect(onClose).toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
  });
  it("submits only on confirmation with the original version and prevents duplicate clicks", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(() => new Promise(r => { resolve = r; }) as never);
    const onReset = vi.fn().mockResolvedValue(undefined), onClose = vi.fn(); render(<ResetPasswordModal user={user} onClose={onClose} onReset={onReset} />);
    const button = screen.getByRole("button", { name: "确认重置" }); fireEvent.click(button); fireEvent.click(button);
    expect(api).toHaveBeenCalledTimes(1); expect(api).toHaveBeenCalledWith("/admin/users/employee/reset-password", { method: "POST", body: JSON.stringify({ expectedVersion: 3 }) });
    resolve(result); await waitFor(() => expect(onReset).toHaveBeenCalledWith(result)); await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it("shows real 403/409 errors and keeps the confirmation open", async () => {
    vi.mocked(api).mockRejectedValue(new Error("用户信息已变化，请刷新后重试")); const onClose = vi.fn();
    render(<ResetPasswordModal user={user} onClose={onClose} onReset={vi.fn()} />); fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    expect(await screen.findByText("用户信息已变化，请刷新后重试")).toBeInTheDocument(); expect(onClose).not.toHaveBeenCalled();
  });
  it("retries only the list refresh after the password command has committed", async () => {
    vi.mocked(api).mockResolvedValue(result as never); const onReset = vi.fn().mockRejectedValueOnce(new Error("列表刷新失败")).mockResolvedValue(undefined), onClose = vi.fn();
    render(<ResetPasswordModal user={user} onClose={onClose} onReset={onReset} />); fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    expect(await screen.findByText("列表刷新失败")).toBeInTheDocument(); expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "刷新列表" })); await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api).toHaveBeenCalledTimes(1); expect(onReset).toHaveBeenCalledTimes(2);
  });
});

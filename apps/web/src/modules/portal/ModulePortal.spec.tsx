import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModulePortal } from "./ModulePortal";

describe("ModulePortal system access", () => {
  it("hides system management from non-system administrators", () => {
    render(<ModulePortal user={{ username: "demo-manager", roles: ["集团管理员"] }} onOpen={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "进入系统管理" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入主计划" })).toBeInTheDocument();
  });

  it("shows system management to system administrators", () => {
    render(<ModulePortal user={{ username: "admin", roles: ["系统管理员"] }} onOpen={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.getByRole("button", { name: "进入系统管理" })).toBeInTheDocument();
  });
});

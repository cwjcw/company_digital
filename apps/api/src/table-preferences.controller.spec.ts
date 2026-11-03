import { AuthController } from "./controllers";

describe("AuthController table preference identity", () => {
  it("always uses the authenticated subject and ignores client user/tenant identity fields", () => {
    const auth = { getTablePreference: jest.fn(), saveTablePreference: jest.fn() };
    const controller = new AuthController(auth as never);
    const request = { user: { sub: "trusted-user" }, requestId: "request-1" } as never;
    controller.getTablePreference("projects", "active", "DISPLAY", request);
    controller.saveTablePreference({ resource: "projects", viewKey: "active", configType: "DISPLAY", config: { visibleFieldKeys: [] }, userId: "attacker", tenantId: "other" } as never, request);
    expect(auth.getTablePreference).toHaveBeenCalledWith("trusted-user", "projects", "active", "DISPLAY");
    expect(auth.saveTablePreference).toHaveBeenCalledWith("trusted-user", "projects", "active", "DISPLAY", { visibleFieldKeys: [] }, "request-1", false);
  });
});

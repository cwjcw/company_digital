import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationCenterPage } from "./NotificationCenterPage";

vi.mock("../../api", () => ({ api: vi.fn(async (path: string) => path === "/notifications/events" ? [{ eventType: "equipment.status.fault_changed", label: "设备故障变化", module: "PMC中心", resource: "equipment-status-report", resourceLabel: "设备状态填报", condition: "故障变化", channelLabel: "企业微信工作通知", variables: ["equipmentCode"] }] : []) }));

describe("NotificationCenterPage", () => {
  it("shows the three message-center tabs, registered event and test-mode banner", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><NotificationCenterPage /></QueryClientProvider>);
    expect(screen.getByText("当前处于企业微信测试模式，实际企业微信消息仅发送给崔玮杰。")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "消息规则" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "发送记录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "失败消息" })).toBeInTheDocument();
    expect(await screen.findByText("设备状态填报")).toBeInTheDocument();
  });
});

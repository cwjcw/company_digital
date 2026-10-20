import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationCenterPage } from "./NotificationCenterPage";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({ api: vi.fn(async (path: string) => path.startsWith("/notifications/events") ? [{ eventType: "equipment.status.fault_changed", label: "设备故障变化", moduleCode:"planning", module: "PMC中心", resource: "equipment-status-report", resourceLabel: "设备状态填报", condition: "故障时长发生变化且新值大于0时触发", channelLabel: "企业微信工作通知", recipientLabels: { EQUIPMENT_RESPONSIBLE: "设备责任人", FIXED_USERS: "指定人员" }, variables: ["equipmentCode"] }, {eventType:"finance.monthly.daily_summary",label:"财务月度数据每日汇总",moduleCode:"finance",module:"财务中心",resource:"finance-e10-monthly",resourceLabel:"月度数据",condition:"每天08:30汇总当月",channelLabel:"企业微信工作通知",recipientRules:["FIXED_USERS"],recipientLabels:{FIXED_USERS:"组织架构 / 角色 / 员工"},variables:["yearMonth","orderTotal"]}] : []) }));

describe("NotificationCenterPage", () => {
  afterEach(cleanup);
  it("offers the finance module returned by registered events",async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><NotificationCenterPage /></QueryClientProvider>);
    await screen.findByText(/月度数据 \/ finance.monthly.daily_summary/);
    fireEvent.mouseDown(screen.getByRole("combobox",{name:"模块"}));
    expect(await screen.findByText("财务中心")).toBeInTheDocument();
  });

  it("shows the three message-center tabs and registered event without the retired validation banner", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><NotificationCenterPage /></QueryClientProvider>);
    expect(screen.queryByText(/企业微信测试模式/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "消息规则" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "发送记录" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "失败消息" })).toBeInTheDocument();
    expect(screen.getByText("新增规则")).toBeInTheDocument();
  });
});

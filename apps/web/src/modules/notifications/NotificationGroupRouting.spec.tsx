import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationGroupRouting } from "./NotificationGroupRouting";

vi.mock("../../api", () => ({ api: vi.fn(async (path: string) => path === "/notifications/group-webhooks" ? [{id:"group-1",groupName:"事业一部设备管理",robotName:"日报机器人",channelType:"WECHAT_GROUP_WEBHOOK",webhookMasked:"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****1234",webhookConfigured:true,moduleCode:"planning",enabled:true,version:2}] : path === "/notifications/recipient-users" ? [{id:"user-1",displayName:"测试负责人",username:"tester"}] : path === "/notifications/recipient-groups" ? [{id:"recipient-1",name:"设备管理群",category:"设备管理",purpose:"日报推送",description:"",enabled:true,version:1,members:[{id:"group-1",groupName:"事业一部设备管理",robotName:"日报机器人",enabled:true,webhookConfigured:true}]}] : path === "/notifications/routes" ? [{id:"route-1",eventType:"equipment.daily_report",label:"设备日报",name:"设备日报",enabled:true,version:3,targets:[{id:"recipient-1",type:"RECIPIENT_GROUP",name:"设备管理群",target_enabled:true,route_enabled:true}]}] : path === "/notifications/routes/events" ? [{eventType:"equipment.daily_report",label:"设备日报",moduleCode:"planning"}] : []) }));

describe("NotificationGroupRouting",()=>{
  afterEach(cleanup);
  it("shows only the masked webhook and exposes actions according to resource permissions",async()=>{
    const {api}=await import("../../api");
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><NotificationGroupRouting tab="webhooks" access={{groupWebhooks:{read:true,create:false,update:true,delete:false,test:true},recipientGroups:{},routes:{}}}/></QueryClientProvider>);
    expect(await screen.findByText(/key=\*\*\*\*1234/)).toBeInTheDocument();
    expect(screen.queryByText(/key=abcdefghijkl/)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"测试发送"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"编辑"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"删除"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"测试发送"}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith("/notifications/group-webhooks/group-1/test",{method:"POST"}));
  });

  it("lists searchable recipient groups with their selected robot members",async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><NotificationGroupRouting tab="recipient-groups" access={{groupWebhooks:{read:true},recipientGroups:{read:true,create:false,update:true,delete:false},routes:{}}}/></QueryClientProvider>);
    expect(await screen.findByText("设备管理群")).toBeInTheDocument();
    expect(screen.getByText("设备管理")).toBeInTheDocument();
    expect(screen.getAllByText("创建时间").length).toBeGreaterThan(0);
    expect(screen.getAllByText("更新时间").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText("搜索组名称、分类或用途"),{target:{value:"不存在"}});
    await waitFor(()=>expect(screen.queryByText("设备管理群")).not.toBeInTheDocument());
  });

  it("provides searchable, status-filtered group members and a selected-only view",async()=>{
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><NotificationGroupRouting tab="recipient-groups" access={{groupWebhooks:{read:true},recipientGroups:{read:true,create:true,update:true,delete:false},routes:{}}}/></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button",{name:"新增收件人组"}));
    expect(await screen.findByPlaceholderText("搜索群名称或机器人名称")).toBeInTheDocument();
    expect(screen.getByText("仅显示已选择")).toBeInTheDocument();
    expect(screen.getByText("全部机器人状态")).toBeInTheDocument();
  });

  it("preserves typed recipient-group targets when saving a route",async()=>{
    const {api}=await import("../../api");
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><NotificationGroupRouting tab="routes" access={{groupWebhooks:{read:true},recipientGroups:{read:true},routes:{read:true,update:true}}}/></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button",{name:"配置"}));
    fireEvent.click(screen.getByRole("button",{name:"OK"}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith("/notifications/routes",expect.objectContaining({method:"POST",body:expect.stringContaining('"type":"RECIPIENT_GROUP"')})));
  });
});

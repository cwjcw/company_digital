import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationGroupRouting } from "./NotificationGroupRouting";

vi.mock("../../api", () => ({ api: vi.fn(async (path: string) => path === "/notifications/group-webhooks" ? [{id:"group-1",groupName:"设备管理群",robotName:"日报机器人",channelType:"WECHAT_GROUP_WEBHOOK",webhookMasked:"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****1234",webhookConfigured:true,moduleCode:"planning",enabled:true,version:2}] : path === "/notifications/recipient-users" ? [{id:"user-1",displayName:"测试负责人",username:"tester"}] : []) }));

describe("NotificationGroupRouting",()=>{
  afterEach(cleanup);
  it("shows only the masked webhook and exposes actions according to resource permissions",async()=>{
    const {api}=await import("../../api");
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><NotificationGroupRouting tab="webhooks" access={{groupWebhooks:{read:true,create:false,update:true,delete:false,test:true},routes:{}}}/></QueryClientProvider>);
    expect(await screen.findByText(/key=\*\*\*\*1234/)).toBeInTheDocument();
    expect(screen.queryByText(/key=abcdefghijkl/)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"测试发送"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"编辑"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"删除"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"测试发送"}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith("/notifications/group-webhooks/group-1/test",{method:"POST"}));
  });
});

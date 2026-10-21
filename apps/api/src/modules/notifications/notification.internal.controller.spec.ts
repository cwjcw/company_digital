import { NotificationInternalController } from './notification.internal.controller';

describe('Finance private attachment HTTP response', () => {
  it('passes tenant/lease identity to the application service and preserves the Chinese filename', async () => {
    const filename='2026年10月接单统计-生管.xlsx',content=Buffer.from('synthetic');
    const notifications={financeAttachment:jest.fn().mockResolvedValue({filename,content})};
    const controller=new NotificationInternalController(notifications as never);
    const response={setHeader:jest.fn(),send:jest.fn()};
    await controller.financeAttachment('outbox','attachment',{notificationTenantId:'T',notificationWorkerId:'worker'} as never,response as never);
    expect(notifications.financeAttachment).toHaveBeenCalledWith('T','outbox','attachment','worker');
    expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition',expect.stringContaining(`filename*=UTF-8''${encodeURIComponent(filename)}`));
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control','no-store');
    expect(response.send).toHaveBeenCalledWith(content);
  });
  it('rejects missing worker identity before attachment lookup', async () => {
    const notifications={financeAttachment:jest.fn()},controller=new NotificationInternalController(notifications as never);
    await expect(controller.financeAttachment('outbox','attachment',{notificationTenantId:'T'} as never,{} as never)).rejects.toThrow('workerId');
    expect(notifications.financeAttachment).not.toHaveBeenCalled();
  });
});

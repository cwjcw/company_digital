import { decryptGroupWebhook, encryptGroupWebhook, validateGroupWebhook } from "./group-webhook.crypto";

describe("group webhook secret handling", () => {
  const previous = process.env.KDOS_NOTIFICATION_SECRET_KEY;
  beforeEach(() => { process.env.KDOS_NOTIFICATION_SECRET_KEY = "unit-test-master-secret"; });
  afterAll(() => { if (previous === undefined) delete process.env.KDOS_NOTIFICATION_SECRET_KEY; else process.env.KDOS_NOTIFICATION_SECRET_KEY = previous; });

  it("encrypts with authenticated encryption and never returns the plaintext through a mask", () => {
    const webhook = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop1234";
    const encrypted = encryptGroupWebhook(webhook);
    expect(encrypted).not.toContain("abcdefghijklmnop1234");
    expect(decryptGroupWebhook(encrypted)).toBe(webhook);
    expect(validateGroupWebhook(webhook).masked).toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=****1234");
  });

  it.each([
    "http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop",
    "https://qyapi.weixin.qq.com.evil.example/cgi-bin/webhook/send?key=abcdefghijklmnop",
    "https://qyapi.weixin.qq.com/cgi-bin/other?key=abcdefghijklmnop",
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send",
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=",
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop&redirect=1",
    "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop&key=qrstuvwxyzabcdef"
  ])("rejects an invalid or non-official webhook: %s", value => {
    expect(() => validateGroupWebhook(value)).toThrow();
  });

  it("fails closed when the master key is missing", () => {
    delete process.env.KDOS_NOTIFICATION_SECRET_KEY;
    expect(() => encryptGroupWebhook("https://example.invalid/")).toThrow(/密钥未配置/);
  });
});

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

const key = () => {
  const secret = String(process.env.KDOS_NOTIFICATION_SECRET_KEY ?? "").trim();
  if (!secret) throw new ServiceUnavailableException("通知Webhook加密密钥未配置，暂不能保存或发送群机器人消息");
  return createHash("sha256").update(secret, "utf8").digest();
};

export function encryptGroupWebhook(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGroupWebhook(value: string): string {
  const [version, ivText, tagText, cipherText, ...rest] = String(value).split(".");
  if (version !== "v1" || !ivText || !tagText || !cipherText || rest.length) throw new Error("群机器人凭据格式无效");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
}

export function validateGroupWebhook(input: unknown): { plaintext: string; masked: string } {
  const value = String(input ?? "").trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new BadRequestException("Webhook格式无效"); }
  const keyValue = url.searchParams.get("key") ?? "";
  if (url.protocol !== "https:" || url.hostname !== "qyapi.weixin.qq.com" || url.port || url.username || url.password ||
      url.pathname !== "/cgi-bin/webhook/send" || [...url.searchParams.keys()].some((name) => name !== "key") ||
      url.searchParams.getAll("key").length !== 1 || !/^[A-Za-z0-9_-]{16,128}$/.test(keyValue) || url.hash) {
    throw new BadRequestException("仅允许企业微信官方机器人 Webhook（https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…）");
  }
  return { plaintext: url.toString(), masked: `${url.origin}${url.pathname}?key=****${keyValue.slice(-4)}` };
}

export function redactWebhook(value: string, webhook?: string): string {
  const clean = value.replace(/https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[^\s"'&]+/gi, "[webhook已隐藏]");
  return webhook ? clean.split(webhook).join("[webhook已隐藏]") : clean;
}

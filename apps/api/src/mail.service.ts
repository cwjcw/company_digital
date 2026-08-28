import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";

@Injectable()
export class MailService {
  private transporter() {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASSWORD;
    if (!host || !user || !pass) throw new ServiceUnavailableException("密码找回邮件服务尚未配置");
    return nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 465),
      secure: String(process.env.SMTP_SECURE ?? "true").toLowerCase() === "true",
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    });
  }

  async sendPasswordResetCode(email: string, displayName: string, code: string) {
    const sender = process.env.SMTP_USER!.trim();
    await this.transporter().sendMail({
      from: `"凯南数字化工作台" <${sender}>`,
      to: email,
      subject: "凯南数字化工作台密码重置验证码",
      text: `${displayName}，您好：\n\n您的密码重置验证码是：${code}\n验证码 10 分钟内有效，最多允许尝试 5 次。\n如非本人操作，请忽略本邮件。`,
      html: `<p>${this.escape(displayName)}，您好：</p><p>您的密码重置验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效，最多允许尝试 5 次。</p><p>如非本人操作，请忽略本邮件。</p>`
    });
  }

  async verifyConfiguration() { await this.transporter().verify(); }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
  }
}

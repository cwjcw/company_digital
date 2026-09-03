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

  async sendTemporaryPassword(email: string, displayName: string, temporaryPassword: string) {
    const sender = process.env.SMTP_USER!.trim();
    await this.transporter().sendMail({
      from: `"凯南数字化工作台" <${sender}>`,
      to: email,
      subject: "凯南数字化工作台临时密码",
      text: `${displayName}，您好：\n\n您的 8 位临时密码是：${temporaryPassword}\n请使用该密码登录，并按系统提示立即修改密码。\n如非本人操作，请立即联系系统管理员。`,
      html: `<p>${this.escape(displayName)}，您好：</p><p>您的 8 位临时密码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${temporaryPassword}</p><p>请使用该密码登录，并按系统提示立即修改密码。</p><p>如非本人操作，请立即联系系统管理员。</p>`
    });
  }

  async verifyConfiguration() { await this.transporter().verify(); }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
  }
}

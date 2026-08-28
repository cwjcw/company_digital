import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Descriptions, Form, Input, Space, Tag, Typography, message } from "antd";
import { useState } from "react";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";

const { Paragraph, Text, Title } = Typography;
const passwordRule = /^(?=.{8,64}$)(?=.*[A-Za-z])(?=.*\d)\S+$/;
const passwordRuleText = "密码须为 8–64 位，至少包含一个字母和一个数字，不能包含空格，且不能与当前密码相同";

export function ProfileCenterPage() {
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const changePassword = async (values: { currentPassword: string; nextPassword: string }) => {
    setSaving(true);
    try {
      const result = await api<any>("/auth/change-password", { method: "POST", body: JSON.stringify(values) });
      localStorage.setItem("accessToken", result.accessToken);
      localStorage.setItem("refreshToken", result.refreshToken);
      localStorage.setItem("sessionUser", JSON.stringify(result.user));
      form.resetFields();
      message.success("登录密码已更新");
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  return <div className="profile-center-page">
    <PageHeader title="个人中心" subtitle="查看账户资料并维护个人安全设置" />
    <div className="profile-center-grid">
      <Card bordered={false} className="profile-overview-card">
        <div className="profile-identity">
          <span className="profile-large-avatar"><UserOutlined /></span>
          <div><Text type="secondary">当前登录用户</Text><Title level={2}>{user.displayName ?? user.username}</Title><Paragraph type="secondary">账号：{user.username}</Paragraph></div>
        </div>
        <Descriptions column={1} bordered size="small" items={[
          { key: "roles", label: "所属角色", children: <Space wrap>{(user.roles ?? []).map((role: string) => <Tag color="blue" key={role}>{role}</Tag>)}</Space> },
          { key: "scope", label: "数据范围", children: user.divisions === "*" ? "全部事业部" : (user.divisions ?? []).join("、") || "未配置" },
          { key: "state", label: "账户状态", children: <Tag color="green">正常</Tag> }
        ]} />
        <div className="profile-security-note"><SafetyCertificateOutlined /><span><strong>账户安全由统一身份系统保护</strong><small>请勿与他人共享账号和登录密码。</small></span></div>
      </Card>
      <Card bordered={false} className="profile-password-card" title={<Space><LockOutlined />修改登录密码</Space>}>
        <Paragraph type="secondary">{passwordRuleText}</Paragraph>
        <Form form={form} layout="vertical" onFinish={changePassword} requiredMark={false}>
          <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: "请输入当前密码" }]}><Input.Password autoComplete="current-password" /></Form.Item>
          <Form.Item name="nextPassword" label="新密码" dependencies={["currentPassword"]} rules={[{ required: true, pattern: passwordRule, message: passwordRuleText }, ({ getFieldValue }) => ({ validator(_, value) { return !value || value !== getFieldValue("currentPassword") ? Promise.resolve() : Promise.reject(new Error("新密码不能与当前密码相同")); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" dependencies={["nextPassword"]} rules={[{ required: true, message: "请再次输入新密码" }, ({ getFieldValue }) => ({ validator(_, value) { return !value || getFieldValue("nextPassword") === value ? Promise.resolve() : Promise.reject(new Error("两次输入的密码不一致")); } })]}><Input.Password autoComplete="new-password" /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} block>确认修改密码</Button>
        </Form>
      </Card>
    </div>
  </div>;
}

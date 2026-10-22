import { useRef, useState } from "react";
import { Alert, Modal, Typography } from "antd";
import { api } from "../../api";

export type PasswordResetUser = { id: string; username: string; displayName: string; version: number };
export type PasswordResetResult = { id: string; reset: boolean; mustChangePassword: boolean; version: number };

export function ResetPasswordModal({ user, onClose, onReset }: { user: PasswordResetUser; onClose: () => void; onReset: (result: PasswordResetResult) => Promise<void> }) {
  const lock = useRef(false), receipt = useRef<PasswordResetResult | null>(null);
  const [busy, setBusy] = useState(false), [completed, setCompleted] = useState(false), [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      if (!receipt.current) {
        receipt.current = await api<PasswordResetResult>(`/admin/users/${user.id}/reset-password`, { method: "POST", body: JSON.stringify({ expectedVersion: user.version }) });
        setCompleted(true);
      }
      await onReset(receipt.current);
      onClose();
    } catch (e) { setError((e as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal title="重置密码" open onCancel={() => { if (!lock.current) onClose(); }} onOk={() => void confirm()}
    okText={completed ? "刷新列表" : "确认重置"} cancelText="取消" confirmLoading={busy} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: busy }}>
    <Typography.Paragraph>将 {user.displayName}（账号：{user.username}）的密码重置为默认密码。</Typography.Paragraph>
    <Alert type="warning" showIcon message="默认密码：kn123456" description="该用户下次登录时必须修改密码。权限、部门、角色及账号启停状态保持原样。" />
    {completed && <Alert type="success" message="密码已重置；列表刷新失败时可重试刷新，不会再次重置。" />}
    {error && <Alert type="error" showIcon message={error} />}
  </Modal>;
}

import { useState } from "react";
import { Alert, Button, Card, Form, Input, Modal, Space, Tag, Upload, message } from "antd";
import { FolderOpenOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";
import { hasResourcePermission, KdosDataTable } from "../../shared/KdosDataTable";

type CheckRow = { key: string; account: string; name: string; status: "入职" | "离职" };

export function HrDepartureCheckPage() {
  const [rows, setRows] = useState<CheckRow[]>([]);
  const [summary, setSummary] = useState<{ total: number; active: number; departed: number }>();
  const [checking, setChecking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);
  const [manualForm] = Form.useForm<{ account: string; name: string }>();
  const summarize = (nextRows: CheckRow[]) => ({ total: nextRows.length, active: nextRows.filter((row) => row.status === "入职").length, departed: nextRows.filter((row) => row.status === "离职").length });
  const check = async (file: File) => {
    const form = new FormData(); form.append("file", file); setChecking(true);
    try {
      const result = await api<{ rows: Omit<CheckRow, "key">[]; summary: { total: number; active: number; departed: number } }>("/hr/departure-check", { method: "POST", body: form });
      setRows(result.rows.map((row, index) => ({ ...row, key: `${row.account}:${index}` }))); setSummary(result.summary);
      message.success(`检查完成：${result.summary.total} 人`);
    } catch (error) { message.error((error as Error).message); } finally { setChecking(false); }
    return false;
  };
  const addManual = async (values: { account: string; name: string }) => {
    setManualChecking(true);
    try {
      const result = await api<{ row: Omit<CheckRow, "key"> }>("/hr/departure-check/manual", { method: "POST", body: JSON.stringify(values) });
      setRows((current) => {
        const normalized = result.row.account.trim().toLowerCase();
        const existing = current.findIndex((row) => row.account.trim().toLowerCase() === normalized);
        const nextRow = { ...result.row, key: existing >= 0 ? current[existing]!.key : `manual:${normalized}` };
        const next = existing >= 0 ? current.map((row, index) => index === existing ? nextRow : row) : [...current, nextRow];
        setSummary(summarize(next));
        return next;
      });
      manualForm.resetFields(); setManualOpen(false); message.success(`已新增并判断为“${result.row.status}”`);
    } catch (error) { message.error((error as Error).message); } finally { setManualChecking(false); }
  };
  const exportCsv = () => {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = `\uFEFF${[["账号", "姓名", "状态"], ...rows.map((row) => [row.account, row.name, row.status])].map((row) => row.map(escape).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "离职人员检查结果.csv"; link.click(); URL.revokeObjectURL(url);
  };
  const columns = [
    { title: "账号", dataIndex: "account", width: 200 },
    { title: "姓名", dataIndex: "name", width: 200 },
    { title: "状态", dataIndex: "status", width: 140, render: (status: CheckRow["status"]) => <Tag color={status === "入职" ? "green" : "default"}>{status}</Tag> }
  ];
  return <div>
    <PageHeader title="离职人员检查" subtitle="上传或手工录入账号和姓名，与最新企业微信通讯录中的在职状态进行核对" actions={<Space>
      {hasResourcePermission("hr-departure-check", "create") && <Button icon={<PlusOutlined />} onClick={() => setManualOpen(true)}>手工新增</Button>}
      {hasResourcePermission("hr-departure-check", "import") && <Upload accept=".xlsx,.csv" showUploadList={false} beforeUpload={(file) => check(file as File)}><Button type="primary" icon={<UploadOutlined />} loading={checking}>上传检查文件</Button></Upload>}
      <Button disabled={!rows.length} onClick={exportCsv}>导出检查结果</Button>
    </Space>} />
    <Alert type="info" showIcon message="检查说明" description="可以手工新增，也可以上传 XLSX/CSV；文件必须包含“账号”和“姓名”两列。状态只显示“入职”或“离职”，以最新通讯录为准。" style={{ marginBottom: 16 }} />
    {summary && <Space style={{ marginBottom: 12 }}><Tag>总数 {summary.total}</Tag><Tag color="green">入职 {summary.active}</Tag><Tag>离职 {summary.departed}</Tag></Space>}
    <KdosDataTable resource="hr-departure-check" rowKey="key" dataSource={rows} columns={columns} scroll={{ y: "calc(100vh - 350px)" }} />
    <Modal title="手工新增离职人员检查" open={manualOpen} okText="新增并检查" cancelText="取消" confirmLoading={manualChecking} onOk={() => manualForm.submit()} onCancel={() => { if (!manualChecking) { setManualOpen(false); manualForm.resetFields(); } }}>
      <Form form={manualForm} layout="vertical" onFinish={(values) => void addManual(values)} style={{ marginTop: 20 }}>
        <Form.Item label="账号" name="account" rules={[{ required: true, whitespace: true, message: "请输入账号" }, { max: 100 }]}><Input placeholder="例如：05504" autoFocus /></Form.Item>
        <Form.Item label="姓名" name="name" rules={[{ required: true, whitespace: true, message: "请输入姓名" }, { max: 100 }]}><Input placeholder="例如：李婷" /></Form.Item>
      </Form>
    </Modal>
  </div>;
}

export function HrFolderPage({ title }: { title: string }) {
  return <div><PageHeader title={title} subtitle="人力资源六大模块文件夹" /><Card><Space><FolderOpenOutlined />该文件夹已建立，可继续添加子标签或业务文件。</Space></Card></div>;
}

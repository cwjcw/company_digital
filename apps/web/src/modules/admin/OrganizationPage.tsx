import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApartmentOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Tag, Tooltip } from "antd";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";
import { KdosDataTable } from "../../shared/KdosDataTable";

type OrganizationRow = {
  id: string; wechatDepartmentId: string | null; name: string; pathLabel: string; level: number;
  leaderNames: string[]; memberCount: number; enabled: boolean; updatedAt: string;
};

export function OrganizationPage() {
  const queryClient = useQueryClient();
  const rows = useQuery({ queryKey: ["organization-units"], queryFn: () => api<OrganizationRow[]>("/admin/organization-units") });
  const columns = [
    { title: "组织路径", dataIndex: "pathLabel", width: 360, render: (value: string) => <Tooltip title={value}><span>{value}</span></Tooltip> },
    { title: "部门名称", dataIndex: "name", width: 180 },
    { title: "企业微信部门 ID", dataIndex: "wechatDepartmentId", width: 180, render: (value: string | null) => value || "—" },
    { title: "层级", dataIndex: "level", width: 90 },
    { title: "部门负责人", dataIndex: "leaderNames", width: 240, render: (names: string[]) => names?.length ? <Space wrap>{names.map((name) => <Tag color="blue" key={name}>{name}</Tag>)}</Space> : "—" },
    { title: "直属在职成员", dataIndex: "memberCount", width: 130 },
    { title: "状态", dataIndex: "enabled", width: 100, render: (enabled: boolean) => <Tag color={enabled ? "success" : "default"}>{enabled ? "启用" : "停用"}</Tag> },
    { title: "最近更新", dataIndex: "updatedAt", width: 190, render: (value: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—" }
  ];
  return <div>
    <PageHeader title="组织架构表" subtitle="企业微信是组织、成员归属和部门负责人的权威来源" actions={<Button icon={<ReloadOutlined />} loading={rows.isFetching} onClick={() => void queryClient.invalidateQueries({ queryKey: ["organization-units"] })}>刷新同步结果</Button>} />
    <Alert showIcon icon={<ApartmentOutlined />} type="info" message="组织架构随企业微信通讯录全量同步，当前计划每天 03:00 自动更新；部门字段始终保存稳定部门 ID。" style={{ marginBottom: 12 }} />
    <KdosDataTable resource="organization" rowKey="id" loading={rows.isLoading} dataSource={rows.data} columns={columns} scroll={{ x: "max-content", y: "calc(100vh - 330px)" }} />
  </div>;
}

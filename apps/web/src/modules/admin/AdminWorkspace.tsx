import { useDeferredValue, useEffect, useMemo, useState, type Key } from "react";
import {
  ApartmentOutlined, CheckCircleFilled, EditOutlined, EllipsisOutlined, ExportOutlined,
  FolderOutlined, ImportOutlined, MoreOutlined, PlusOutlined, SearchOutlined, StopOutlined,
  SwapOutlined, TeamOutlined, UserAddOutlined, UserDeleteOutlined, UserSwitchOutlined
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tableResourceRegistry } from "@kdos/contracts";
import {
  Avatar, Button, Checkbox, Drawer, Dropdown, Flex, Form, Input, Modal, Select, Space, Tabs,
  Tag, Tree, TreeSelect, Typography, message
} from "antd";
import { api } from "../../api";
import { KdosDataTable } from "../../shared/KdosDataTable";

const { Text, Title } = Typography;
type ViewMode = "departments" | "roles";
type ActionKind = "HANDOVER" | "TRANSFER";

function initials(name: string) { return String(name || "员").trim().slice(0, 1); }
function pathKey(path: string[]) { return path.join(" / "); }

export function AdminWorkspace() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ViewMode>("departments");
  const [search, setSearch] = useState(""); const deferredSearch = useDeferredValue(search);
  const [departmentSearch, setDepartmentSearch] = useState("");
  const [status, setStatus] = useState<"all" | "enabled" | "disabled">("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>();
  const [selectedUserIds, setSelectedUserIds] = useState<Key[]>([]);
  const [employeeDrawer, setEmployeeDrawer] = useState(false); const [editingUser, setEditingUser] = useState<any>();
  const [employeeTab, setEmployeeTab] = useState("basic"); const [savingEmployee, setSavingEmployee] = useState(false);
  const [action, setAction] = useState<{ kind: ActionKind; user: any }>(); const [actionValue, setActionValue] = useState<string>();
  const [employeeForm] = Form.useForm();

  const [selectedRoleId, setSelectedRoleId] = useState<string>(); const [roleSearch, setRoleSearch] = useState("");
  const [roleMemberSearch, setRoleMemberSearch] = useState("");
  const [roleDialog, setRoleDialog] = useState<"group" | "role" | "rename">(); const [editingRole, setEditingRole] = useState<any>();
  const [moveRole, setMoveRole] = useState<any>(); const [moveGroupId, setMoveGroupId] = useState<string>();
  const [permissionRole, setPermissionRole] = useState<any>(); const [permissionDraft, setPermissionDraft] = useState<Record<string, Record<string, boolean>>>({});
  const [assignmentUsers, setAssignmentUsers] = useState<string[]>([]); const [assignmentOrganizations, setAssignmentOrganizations] = useState<string[]>([]);
  const [memberDialog, setMemberDialog] = useState(false); const [memberDraft, setMemberDraft] = useState<string[]>([]);
  const [roleForm] = Form.useForm();

  const effectiveUserSearch = mode === "departments" ? deferredSearch : "";
  const users = useQuery({ queryKey: ["admin-users", effectiveUserSearch], queryFn: () => api<any[]>(`/admin/users?search=${encodeURIComponent(effectiveUserSearch)}`) });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<any[]>("/admin/roles") });
  const roleGroups = useQuery({ queryKey: ["admin-role-groups"], queryFn: () => api<any[]>("/admin/role-groups") });
  const organizations = useQuery({ queryKey: ["organization-units"], queryFn: () => api<any[]>("/admin/organization-units") });

  const refreshUsers = () => void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  const refreshRoles = () => { void queryClient.invalidateQueries({ queryKey: ["admin-roles"] }); void queryClient.invalidateQueries({ queryKey: ["admin-role-groups"] }); };
  const organizationMap = useMemo(() => new Map((organizations.data ?? []).map((unit) => [unit.id, unit])), [organizations.data]);
  const unitPath = (id: string) => {
    const names: string[] = []; let unit = organizationMap.get(id); const seen = new Set<string>();
    while (unit && !seen.has(unit.id)) { seen.add(unit.id); names.unshift(unit.name); unit = unit.parentId ? organizationMap.get(unit.parentId) : undefined; }
    return names;
  };
  const unitIdForPath = (path: string[]) => (organizations.data ?? []).find((unit) => pathKey(unitPath(unit.id)) === pathKey(path))?.id;
  const organizationTree = (() => {
    const units = organizations.data ?? [];
    const keyword = departmentSearch.trim().toLowerCase();
    const make = (parentId: string | null): any[] => units
      .filter((unit) => (unit.parentId ?? null) === parentId && unit.enabled !== false)
      .map((unit) => {
        const children = make(unit.id);
        if (keyword && !String(unit.name).toLowerCase().includes(keyword) && children.length === 0) return null;
        return { key: unit.id, value: unit.id, title: unit.name, icon: <ApartmentOutlined />, children };
      })
      .filter(Boolean);
    return make(null);
  })();

  const visibleUsers = (users.data ?? []).filter((user) => {
    if (status === "enabled" && !user.enabled) return false; if (status === "disabled" && user.enabled) return false;
    if (!selectedDepartment) return true;
    const selectedPath = unitPath(selectedDepartment);
    return (user.departmentPaths ?? []).some((path: string[]) => selectedPath.every((part, index) => path[index] === part));
  });

  const openEmployee = (user?: any) => {
    setEditingUser(user); setEmployeeTab("basic"); setEmployeeDrawer(true);
    employeeForm.setFieldsValue(user ? {
      ...user, departmentIds: (user.departmentPaths ?? []).map(unitIdForPath).filter(Boolean), password: undefined
    } : { enabled: true, roleIds: [], departmentIds: [], password: "kn123456" });
  };
  const saveEmployee = async () => {
    try {
      const values = await employeeForm.validateFields(); setSavingEmployee(true);
      const departmentPaths = (values.departmentIds ?? []).map((id: string) => unitPath(id)).filter((path: string[]) => path.length);
      const payload = { ...values, departmentIds: undefined, departmentPaths, division: departmentPaths.flat().find((value: string) => value.includes("事业部")) ?? null };
      if (editingUser) { delete payload.password; await api(`/admin/users/${editingUser.id}`, { method: "PATCH", body: JSON.stringify(payload) }); }
      else await api("/admin/users", { method: "POST", body: JSON.stringify(payload) });
      message.success(editingUser ? "员工信息已保存" : "成员已邀请"); setEmployeeDrawer(false); refreshUsers(); refreshRoles();
    } catch (error) { if (!(error && typeof error === "object" && "errorFields" in error)) message.error((error as Error).message); }
    finally { setSavingEmployee(false); }
  };
  const performEmployeeAction = async (user: any, kind: string, payload: Record<string, unknown> = {}) => {
    try {
      await api(`/admin/users/${user.id}/actions`, { method: "POST", body: JSON.stringify({ action: kind, ...payload }) });
      message.success(({ HANDOVER: "工作交接已登记", DISABLE: "员工已停用", TRANSFER: "员工部门已转移", DEPARTURE: "员工已转为离职" } as any)[kind]);
      setAction(undefined); setActionValue(undefined); refreshUsers();
    } catch (error) { message.error((error as Error).message); }
  };
  const employeeMenu = (user: any) => ({ items: [
    { key: "edit", icon: <EditOutlined />, label: "编辑" }, { key: "handover", icon: <SwapOutlined />, label: "交接工作" },
    { key: "disable", icon: <StopOutlined />, label: "停用", disabled: !user.enabled }, { key: "transfer", icon: <UserSwitchOutlined />, label: "转移" },
    { type: "divider" as const }, { key: "departure", icon: <UserDeleteOutlined />, label: <span className="danger-menu-label">离职</span> }
  ], onClick: ({ key }: { key: string }) => {
    if (key === "edit") openEmployee(user);
    if (key === "handover" || key === "transfer") { setAction({ kind: key === "handover" ? "HANDOVER" : "TRANSFER", user }); setActionValue(undefined); }
    if (key === "disable") Modal.confirm({ title: `停用 ${user.displayName}？`, content: "停用后该员工将无法登录。", okText: "停用", okButtonProps: { danger: true }, onOk: () => performEmployeeAction(user, "DISABLE") });
    if (key === "departure") Modal.confirm({ title: `将 ${user.displayName} 转为离职？`, content: "离职员工将无法登录，历史记录会继续保留。", okText: "确认离职", okButtonProps: { danger: true }, onOk: () => performEmployeeAction(user, "DEPARTURE") });
  }});
  const userColumns = [
    { title: "姓名", dataIndex: "displayName", width: 220, render: (value: string, row: any) => <Space><Avatar className="employee-table-avatar">{initials(value)}</Avatar><Text strong>{value}</Text>{String(row.username).toLowerCase() === "admin" && <Tag color="blue">创建者</Tag>}</Space> },
    { title: "编号", dataIndex: "employeeNo", width: 180, render: (value: string, row: any) => value || row.username },
    { title: "手机", dataIndex: "mobile", width: 170, render: (value: string) => value || "—" },
    { title: "部门", dataIndex: "departmentPaths", width: 190, render: (paths: string[][]) => (paths ?? []).map((path) => path.at(-1)).filter(Boolean).join("、") || "—" },
    { title: "角色", dataIndex: "roles", width: 190, render: (values: string[]) => values?.join("、") || "—" },
    { title: "操作", key: "actions", width: 90, align: "center" as const, fixed: "right" as const, render: (_: unknown, row: any) => <Dropdown menu={employeeMenu(row)} trigger={["click"]}><Button type="text" aria-label={`操作-${row.displayName}`} icon={<EllipsisOutlined />} /></Dropdown> }
  ];

  useEffect(() => { if (!selectedRoleId && roles.data?.length) setSelectedRoleId(roles.data[0].id); }, [roles.data, selectedRoleId]);
  const selectedRole = roles.data?.find((role) => role.id === selectedRoleId);
  const roleMemberKeyword = roleMemberSearch.trim().toLowerCase();
  const roleMembers = (users.data ?? []).filter((user) => selectedRoleId && user.roleIds?.includes(selectedRoleId))
    .filter((user) => !roleMemberKeyword || [user.displayName, user.employeeNo, user.username, user.mobile]
      .some((value) => String(value ?? "").toLowerCase().includes(roleMemberKeyword)));
  const openRoleDialog = (kind: "group" | "role" | "rename", role?: any) => {
    setRoleDialog(kind); setEditingRole(role);
    roleForm.setFieldsValue(kind === "rename" ? { name: role.name } : kind === "role" ? { roleGroupId: roleGroups.data?.[0]?.id } : {});
  };
  const saveRoleDialog = async () => {
    try {
      const values = await roleForm.validateFields();
      if (roleDialog === "group") await api("/admin/role-groups", { method: "POST", body: JSON.stringify(values) });
      else if (roleDialog === "rename") await api(`/admin/roles/${editingRole.id}`, { method: "PATCH", body: JSON.stringify({ name: values.name }) });
      else await api("/admin/roles", { method: "POST", body: JSON.stringify(values) });
      message.success(roleDialog === "group" ? "角色组已创建" : roleDialog === "rename" ? "角色名称已修改" : "角色已创建"); setRoleDialog(undefined); roleForm.resetFields(); refreshRoles();
    } catch (error) { if (!(error && typeof error === "object" && "errorFields" in error)) message.error((error as Error).message); }
  };
  const saveMoveRole = async () => {
    if (!moveRole || !moveGroupId) return;
    try { await api(`/admin/roles/${moveRole.id}`, { method: "PATCH", body: JSON.stringify({ roleGroupId: moveGroupId }) }); message.success("角色分组已调整"); setMoveRole(undefined); refreshRoles(); }
    catch (error) { message.error((error as Error).message); }
  };
  const deleteRole = (role: any) => Modal.confirm({ title: `删除角色“${role.name}”？`, content: "该角色与用户的关联及权限配置会一并删除。", okText: "删除", okButtonProps: { danger: true }, onOk: async () => {
    try { await api(`/admin/roles/${role.id}`, { method: "DELETE" }); message.success("角色已删除"); if (selectedRoleId === role.id) setSelectedRoleId(undefined); refreshRoles(); refreshUsers(); }
    catch (error) { message.error((error as Error).message); }
  }});
  const roleMenu = (role: any) => ({ items: [
    { key: "rename", label: "修改名称" }, { key: "move", label: "调整分组" }, { key: "permissions", label: "配置权限" },
    { type: "divider" as const }, { key: "delete", label: <span className="danger-menu-label">删除</span> }
  ], onClick: ({ key }: { key: string }) => {
    if (key === "rename") openRoleDialog("rename", role); if (key === "move") { setMoveRole(role); setMoveGroupId(role.roleGroupId); }
    if (key === "permissions") openPermissions(role); if (key === "delete") deleteRole(role);
  }});
  const openPermissions = (role: any) => {
    const next: Record<string, Record<string, boolean>> = {};
    for (const resource of tableResourceRegistry) {
      const saved = role.permissions?.find((permission: any) => permission.resource === resource.code && permission.fieldKey === "*") ?? {};
      next[resource.code] = Object.fromEntries(["read", "create", "copy", "update", "delete", "batchPrint", "batchUpdate", "import", "export"].map((action) => [action, Boolean(saved[action])])) as Record<string, boolean>;
    }
    setPermissionRole(role); setPermissionDraft(next); setAssignmentUsers(role.userIds ?? []); setAssignmentOrganizations(role.organizationUnitIds ?? []);
  };
  const savePermissions = async () => {
    if (!permissionRole) return;
    try {
      await api(`/admin/roles/${permissionRole.id}`, { method: "PATCH", body: JSON.stringify({
        userIds: assignmentUsers, organizationUnitIds: assignmentOrganizations,
        permissions: tableResourceRegistry.map((resource) => ({ resource: resource.code, fieldKey: "*", ...(permissionDraft[resource.code] ?? {}) }))
      }) });
      message.success("角色权限已保存"); setPermissionRole(undefined); refreshRoles(); refreshUsers();
    } catch (error) { message.error((error as Error).message); }
  };
  const saveRoleMembers = async () => {
    if (!selectedRole) return;
    try { await api(`/admin/roles/${selectedRole.id}`, { method: "PATCH", body: JSON.stringify({ userIds: memberDraft }) }); message.success("角色成员已更新"); setMemberDialog(false); refreshRoles(); refreshUsers(); }
    catch (error) { message.error((error as Error).message); }
  };
  const exportMembers = () => {
    const header = "姓名,编号,所属部门,角色\n"; const csv = header + roleMembers.map((user) => [user.displayName, user.employeeNo || user.username, (user.departmentPaths ?? []).map((path: string[]) => path.at(-1)).join("|"), selectedRole?.name].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = `${selectedRole?.name ?? "角色"}-成员.csv`; link.click(); URL.revokeObjectURL(url);
  };

  const roleTree = (roleGroups.data ?? []).map((group) => ({ ...group, roles: (roles.data ?? []).filter((role) => role.roleGroupId === group.id && role.name.includes(roleSearch.trim())) }));
  return <div className="employee-admin-page">
    <aside className="employee-admin-sidebar">
      <div className="employee-admin-switch"><button aria-label="切换到部门" className={mode === "departments" ? "active" : ""} onClick={() => setMode("departments")}>部门</button><button aria-label="切换到角色" className={mode === "roles" ? "active" : ""} onClick={() => setMode("roles")}>角色</button></div>
      {mode === "departments" ? <>
        <div className="sidebar-section-title">成员</div>
        <button className={`sidebar-member-item ${!selectedDepartment && status !== "disabled" ? "active" : ""}`} onClick={() => { setSelectedDepartment(undefined); setStatus("all"); }}><TeamOutlined />全部成员</button>
        <button className={`sidebar-member-item ${status === "disabled" ? "active" : ""}`} onClick={() => { setSelectedDepartment(undefined); setStatus("disabled"); }}><UserDeleteOutlined />离职成员</button>
        <div className="sidebar-section-title">部门</div><Input prefix={<SearchOutlined />} allowClear placeholder="搜索" value={departmentSearch} onChange={(event) => setDepartmentSearch(event.target.value)} />
        <Tree showIcon blockNode defaultExpandAll treeData={organizationTree} selectedKeys={selectedDepartment ? [selectedDepartment] : []} onSelect={(keys) => { setSelectedDepartment(String(keys[0] ?? "") || undefined); setStatus("all"); }} />
      </> : <>
        <Input prefix={<SearchOutlined />} allowClear placeholder="搜索" value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)} />
        <Flex className="role-sidebar-heading" justify="space-between" align="center"><span>创建的角色</span><Dropdown trigger={["click"]} menu={{ items: [{ key: "group", icon: <FolderOutlined />, label: "创建角色组" }, { key: "role", icon: <UserAddOutlined />, label: "创建角色" }], onClick: ({ key }) => openRoleDialog(key as "group" | "role") }}><Button type="primary" shape="circle" aria-label="创建角色或角色组" icon={<PlusOutlined />} /></Dropdown></Flex>
        <div className="role-tree-list">{roleTree.map((group) => <div className="role-tree-group" key={group.id}>
          <div className="role-group-title"><FolderOutlined /> <Text strong>{group.name}</Text></div>
          {group.roles.map((role: any) => <div key={role.id} className={`role-tree-role ${selectedRoleId === role.id ? "active" : ""}`} onClick={() => setSelectedRoleId(role.id)}>
            <span><UserSwitchOutlined />{role.name}</span><Dropdown trigger={["click"]} menu={roleMenu(role)}><Button className="admin-role-actions" type="text" aria-label={`编辑角色-${role.name}`} icon={<MoreOutlined />} onClick={(event) => event.stopPropagation()} /></Dropdown>
          </div>)}
        </div>)}</div>
      </>}
    </aside>

    <main className="employee-admin-main">{mode === "departments" ? <>
      <div className="employee-admin-title"><Title level={3}>{selectedDepartment ? organizationMap.get(selectedDepartment)?.name : status === "disabled" ? "离职成员" : "全部成员"}</Title></div>
      <Flex className="employee-admin-toolbar" justify="space-between" align="center" gap={16}>
        <Space><Button type="primary" icon={<UserAddOutlined />} onClick={() => openEmployee()}>邀请成员</Button><Button icon={<ExportOutlined />} onClick={() => message.info("可通过角色页按角色导出成员")}>导出</Button></Space>
        <Space><Input prefix={<SearchOutlined />} allowClear placeholder="搜索成员" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 310 }} /><Text>账号状态</Text><Select value={status} onChange={setStatus} style={{ width: 130 }} options={[{ value: "all", label: "全部" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "已停用" }]} /></Space>
      </Flex>
      <KdosDataTable resource="users" shellClassName="employee-admin-member-table-shell" className="employee-admin-table employee-admin-member-table" rowKey="id" rowSelection={{ selectedRowKeys: selectedUserIds, onChange: setSelectedUserIds }} dataSource={visibleUsers} loading={users.isLoading} columns={userColumns} pagination={false} scroll={{ x: 1750, y: "100%" }} />
    </> : selectedRole ? <>
      <Flex className="employee-admin-title" justify="space-between" align="center"><Title level={3}>{selectedRole.name}</Title><Space split={<span className="role-title-divider" />}><Button type="link" onClick={() => openRoleDialog("rename", selectedRole)}>修改名称</Button><Button type="link" onClick={() => { setMoveRole(selectedRole); setMoveGroupId(selectedRole.roleGroupId); }}>调整分组</Button><Button type="link" onClick={() => openPermissions(selectedRole)}>配置权限</Button></Space></Flex>
      <Flex className="employee-admin-toolbar" justify="space-between"><Space><Button type="primary" onClick={() => { setMemberDraft(selectedRole.userIds ?? []); setMemberDialog(true); }}>添加成员</Button><Button icon={<ImportOutlined />} disabled>导入</Button><Button icon={<ExportOutlined />} onClick={exportMembers}>导出</Button></Space><Input prefix={<SearchOutlined />} allowClear placeholder="搜索成员" value={roleMemberSearch} onChange={(event) => setRoleMemberSearch(event.target.value)} style={{ width: 310 }} /></Flex>
      <KdosDataTable resource="roles" className="employee-admin-table" rowKey="id" dataSource={roleMembers} columns={[
        { title: "姓名", dataIndex: "displayName", render: (value: string) => <Space><Avatar className="employee-table-avatar">{initials(value)}</Avatar>{value}</Space> },
        { title: "所属部门", dataIndex: "departmentPaths", render: (paths: string[][]) => (paths ?? []).map((path) => path.at(-1)).join("、") || "—" },
        { title: "分管部门", render: () => (selectedRole.organizationUnitIds ?? []).map((id: string) => organizationMap.get(id)?.name).filter(Boolean).join("、") || "—" },
        { title: "操作", width: 120, render: (_: unknown, user: any) => <Button danger type="link" onClick={() => { setMemberDraft((selectedRole.userIds ?? []).filter((id: string) => id !== user.id)); setMemberDialog(true); }}>移除</Button> }
      ]} pagination={false} />
    </> : <div className="admin-empty-role"><UserSwitchOutlined /><span>请先创建或选择一个角色</span></div>}</main>

    <Drawer forceRender className="employee-edit-drawer" width={760} title={<div className="employee-drawer-identity"><Avatar>{initials(editingUser?.displayName ?? employeeForm.getFieldValue("displayName") ?? "新")}</Avatar><div><strong>{editingUser?.displayName ?? "邀请成员"}</strong><Space><Tag color="blue">已加入</Tag><Tag color="green">{editingUser?.enabled === false ? "已停用" : "已启用"}</Tag></Space></div></div>} open={employeeDrawer} onClose={() => setEmployeeDrawer(false)} footer={<Space><Button type="primary" loading={savingEmployee} onClick={() => void saveEmployee()}>保存</Button><Dropdown menu={{ items: editingUser ? [{ key: "reset", label: "重置为默认密码" }] : [], onClick: async () => { if (!editingUser) return; await api(`/admin/users/${editingUser.id}/reset-password`, { method: "POST" }); message.success("密码已重置"); } }}><Button>更多</Button></Dropdown></Space>}>
      <Tabs activeKey={employeeTab} onChange={setEmployeeTab} centered items={[{ key: "basic", label: "基础字段" }, { key: "more", label: "更多字段" }]} />
      <Form form={employeeForm} layout="vertical" className="employee-edit-form">
        <div className={employeeTab === "basic" ? "employee-form-grid" : "employee-form-grid hidden-form-section"}>
          <Form.Item name="displayName" label="姓名" rules={[{ required: true, whitespace: true }]}><Input /></Form.Item><Form.Item name="alias" label="别名"><Input placeholder="请输入" /></Form.Item>
          <Form.Item name="username" label="编号" rules={[{ required: true, pattern: /^[a-zA-Z0-9_.-]{3,64}$/ }]} extra={editingUser ? "不支持修改此编号" : undefined}><Input disabled={Boolean(editingUser)} /></Form.Item><Form.Item name="gender" label="性别"><Select allowClear options={[{ value: "男" }, { value: "女" }, { value: "其他" }]} /></Form.Item>
          <Form.Item label="手机" className="employee-form-wide"><Space.Compact block><Input value="+86" disabled style={{ width: 76 }} /><Form.Item name="mobile" noStyle><Input placeholder="请输入手机号" /></Form.Item></Space.Compact></Form.Item>
          <Form.Item name="email" label="邮箱" className="employee-form-wide" rules={[{ type: "email" }]}><Input /></Form.Item>
          <Form.Item name="employeeNo" label="工号" className="employee-form-wide"><Input placeholder="请输入" /></Form.Item>
          <Form.Item name="departmentIds" label="部门" className="employee-form-wide"><TreeSelect treeData={organizationTree} treeDefaultExpandAll multiple allowClear /></Form.Item>
          <Form.Item name="roleIds" label="角色" className="employee-form-wide"><Select mode="multiple" allowClear options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))} placeholder="＋ 选择角色" /></Form.Item>
        </div>
        <div className={employeeTab === "more" ? "employee-form-grid" : "employee-form-grid hidden-form-section"}>
          <Form.Item name="position" label="职位"><Input /></Form.Item><Form.Item name="division" label="所属事业部"><Input disabled /></Form.Item>
          {!editingUser && <Form.Item name="password" label="首次密码" rules={[{ required: true, min: 8 }]} className="employee-form-wide"><Input.Password /></Form.Item>}
          <Form.Item name="enabled" label="账号状态" className="employee-form-wide"><Select options={[{ value: true, label: "已启用" }, { value: false, label: "已停用" }]} /></Form.Item>
        </div>
      </Form>
    </Drawer>

    <Modal title={action?.kind === "HANDOVER" ? "交接工作" : "转移部门"} open={Boolean(action)} onCancel={() => setAction(undefined)} onOk={() => action && actionValue && void performEmployeeAction(action.user, action.kind, action.kind === "HANDOVER" ? { targetUserId: actionValue } : { departmentPaths: [unitPath(actionValue)] })} okButtonProps={{ disabled: !actionValue }}>
      <Form layout="vertical"><Form.Item label={action?.kind === "HANDOVER" ? "选择工作接收人" : "选择转入部门"}>{action?.kind === "HANDOVER" ? <Select showSearch optionFilterProp="label" value={actionValue} onChange={setActionValue} options={(users.data ?? []).filter((user) => user.enabled && user.id !== action?.user.id).map((user) => ({ value: user.id, label: `${user.displayName}（${user.employeeNo ?? user.username}）` }))} /> : <TreeSelect treeData={organizationTree} treeDefaultExpandAll value={actionValue} onChange={setActionValue} />}</Form.Item></Form>
    </Modal>

    <Modal forceRender title={roleDialog === "group" ? "创建角色组" : roleDialog === "rename" ? "修改角色名称" : "创建角色"} open={Boolean(roleDialog)} onCancel={() => setRoleDialog(undefined)} onOk={() => void saveRoleDialog()}>
      <Form form={roleForm} layout="vertical"><Form.Item name="name" label={roleDialog === "group" ? "角色组名称" : "角色名称"} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>{roleDialog === "role" && <Form.Item name="roleGroupId" label="所属分组" rules={[{ required: true }]}><Select options={(roleGroups.data ?? []).map((group) => ({ value: group.id, label: group.name }))} /></Form.Item>}</Form>
    </Modal>
    <Modal title="调整分组" open={Boolean(moveRole)} onCancel={() => setMoveRole(undefined)} onOk={() => void saveMoveRole()}>
      <Text type="secondary">请选择目标分组</Text><div className="role-group-picker">{(roleGroups.data ?? []).map((group) => <button key={group.id} className={moveGroupId === group.id ? "active" : ""} onClick={() => setMoveGroupId(group.id)}><span><FolderOutlined />{group.name}</span>{moveGroupId === group.id && <CheckCircleFilled />}</button>)}</div>
    </Modal>
    <Modal title="添加角色成员" open={memberDialog} onCancel={() => setMemberDialog(false)} onOk={() => void saveRoleMembers()}><Select mode="multiple" showSearch optionFilterProp="label" value={memberDraft} onChange={setMemberDraft} style={{ width: "100%" }} options={(users.data ?? []).map((user) => ({ value: user.id, label: `${user.displayName}（${user.employeeNo ?? user.username}）` }))} /></Modal>
    <Modal title={`配置角色：${permissionRole?.name ?? ""}`} width={1120} open={Boolean(permissionRole)} onCancel={() => setPermissionRole(undefined)} onOk={() => void savePermissions()}>
      <Flex gap={12} className="role-scope-row"><Select mode="multiple" showSearch optionFilterProp="label" value={assignmentUsers} onChange={setAssignmentUsers} placeholder="关联用户（只有角色可以关联）" options={(users.data ?? []).map((user) => ({ value: user.id, label: user.displayName }))} style={{ flex: 1 }} /><TreeSelect treeData={organizationTree} treeCheckable multiple value={assignmentOrganizations} onChange={setAssignmentOrganizations} placeholder="分管部门" style={{ flex: 1 }} /></Flex>
      <KdosDataTable resource="role-permission-matrix" systemFields={false} size="small" rowKey="resource" pagination={false} dataSource={tableResourceRegistry.map((resource) => ({ ...resource, resource: resource.code }))} columns={[
        { title: "模块", dataIndex: "module", width: 130 }, { title: "表/报表", dataIndex: "label" },
        ...(["read", "create", "copy", "update", "delete", "batchPrint", "batchUpdate", "import", "export"] as const).map((actionName) => ({ title: ({ read: "查看", create: "新增", copy: "复制", update: "编辑", delete: "删除/停用", batchPrint: "批量打印", batchUpdate: "批量修改", import: "导入", export: "导出" } as const)[actionName], width: 92, align: "center" as const, render: (_: unknown, row: any) => <Checkbox checked={Boolean(permissionDraft[row.resource]?.[actionName])} onChange={(event) => setPermissionDraft((current) => ({ ...current, [row.resource]: { ...(current[row.resource] ?? {}), [actionName]: event.target.checked } }))} /> }))
      ]} scroll={{ y: 430 }} />
    </Modal>
  </div>;
}

import { useDeferredValue, useEffect, useMemo, useState, type Key } from "react";
import {
  ApartmentOutlined, CheckCircleFilled, EditOutlined, EllipsisOutlined, ExportOutlined,
  FolderOutlined, HolderOutlined, ImportOutlined, MoreOutlined, PlusOutlined, SearchOutlined, StopOutlined,
  SwapOutlined, TeamOutlined, UserAddOutlined, UserDeleteOutlined, UserSwitchOutlined
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrganizationMembershipIndex } from "@kdos/permissions";
import {
  Avatar, Button, Checkbox, Drawer, Dropdown, Flex, Form, Input, Modal, Select, Space, Tabs,
  Tag, Tree, TreeSelect, Typography, message
} from "antd";
import { api } from "../../api";
import { KdosDataTable } from "../../shared/KdosDataTable";
import { blankPlatformQuery, type PlatformTablePage, type PlatformTableQuery } from "../../shared/platform-table";

const { Text, Title } = Typography;
type ViewMode = "departments" | "roles";
type ActionKind = "HANDOVER" | "TRANSFER";

function initials(name: string) { return String(name || "员").trim().slice(0, 1); }
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
  const [roleDialog, setRoleDialog] = useState<"group" | "role" | "rename" | "rename-group">(); const [editingRole, setEditingRole] = useState<any>();
  const [editingRoleGroup, setEditingRoleGroup] = useState<any>(); const [roleSaving, setRoleSaving] = useState(false);
  const [moveRole, setMoveRole] = useState<any>(); const [moveGroupId, setMoveGroupId] = useState<string>();
  const [moveSaving, setMoveSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "role" | "group"; item: any }>(); const [deleteSaving, setDeleteSaving] = useState(false);
  const [memberDialog, setMemberDialog] = useState(false); const [memberDraft, setMemberDraft] = useState<string[]>([]);
  const [memberOrganizationDraft, setMemberOrganizationDraft] = useState<string[]>([]);
  const [memberMode, setMemberMode] = useState<"people" | "organization">("people");
  const [memberSearch, setMemberSearch] = useState(""); const [memberOrganizationId, setMemberOrganizationId] = useState<string>();
  const [roleForm] = Form.useForm();

  /* KN-FILTER-001：部门视图与角色成员视图都走服务端分页查询；下拉/成员弹窗使用 options 接口（bounded 字段）。 */
  const [departmentQuery, setDepartmentQuery] = useState<PlatformTableQuery>(blankPlatformQuery());
  const [roleMemberQuery, setRoleMemberQuery] = useState<PlatformTableQuery>(blankPlatformQuery());
  const effectiveUserSearch = mode === "departments" ? deferredSearch : "";
  /* 成员候选/下拉统一使用 options 接口；列表使用服务端分页。 */
  const directory = useQuery({ queryKey: ["admin-users-options"], queryFn: () => api<any[]>("/admin/users?options=1") });
  const adminUsersUrl = (base: PlatformTableQuery, context: { status?: string; departmentId?: string; roleId?: string; search?: string }) => {
    const params = new URLSearchParams({ page: String(base.page), pageSize: String(base.pageSize) });
    if (context.search) params.set("search", context.search);
    if (context.status && context.status !== "all") params.set("status", context.status);
    if (context.departmentId) params.set("departmentId", context.departmentId);
    if (context.roleId) params.set("roleId", context.roleId);
    if (base.filterGroup?.rules?.length || base.filterGroup?.groups?.length) params.set("filterGroup", JSON.stringify(base.filterGroup));
    if (base.sortField) params.set("sortField", base.sortField);
    if (base.sortOrder) params.set("sortOrder", base.sortOrder);
    return `/admin/users?${params}`;
  };
  const departmentMembers = useQuery({
    queryKey: ["admin-users", "departments", departmentQuery, effectiveUserSearch, status, selectedDepartment ?? ""],
    queryFn: () => api<PlatformTablePage<any>>(adminUsersUrl(departmentQuery, { search: effectiveUserSearch, status, departmentId: selectedDepartment })),
    placeholderData: (previous) => previous,
    enabled: mode === "departments"
  });
  const roleMembersPage = useQuery({
    queryKey: ["admin-users", "roles", roleMemberQuery, roleMemberSearch, selectedRoleId ?? ""],
    queryFn: () => api<PlatformTablePage<any>>(adminUsersUrl(roleMemberQuery, { search: roleMemberSearch, roleId: selectedRoleId })),
    placeholderData: (previous) => previous,
    enabled: mode === "roles" && Boolean(selectedRoleId)
  });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<any[]>("/admin/roles") });
  const roleGroups = useQuery({ queryKey: ["admin-role-groups"], queryFn: () => api<any[]>("/admin/role-groups") });
  const organizations = useQuery({ queryKey: ["organization-units"], queryFn: () => api<any[]>("/admin/organization-units") });

  const refreshUsers = () => void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  const refreshRoles = () => { void queryClient.invalidateQueries({ queryKey: ["admin-roles"] }); void queryClient.invalidateQueries({ queryKey: ["admin-role-groups"] }); };
  const organizationMap = useMemo(() => new Map((organizations.data ?? []).map((unit) => [unit.id, unit])), [organizations.data]);
  const organizationMembership = useMemo(() => createOrganizationMembershipIndex(organizations.data ?? []), [organizations.data]);
  const unitPath = organizationMembership.pathFor;
  const unitIdForPath = organizationMembership.unitIdForDepartmentPath;
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

  /* 服务端已完成 部门 + 状态 + 搜索 + FilterGroup 的 AND；前端不再过滤。 */
  const visibleUsers = departmentMembers.data?.rows ?? [];

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
  const userBelongsToAnyOrganization = (user: any, organizationIds: string[]) => organizationIds.some((organizationId) =>
    (user.departmentPaths ?? []).some((path: string[]) => organizationMembership.departmentPathBelongsTo(path, organizationId)));
  /* 角色成员由服务端按 selectedRoleId（角色关系 ∪ 角色授权组织范围）强制约束，客户端无法移除该条件。 */
  const roleMembers = roleMembersPage.data?.rows ?? [];
  const openRoleDialog = (kind: "group" | "role" | "rename", role?: any, group?: any) => {
    roleForm.resetFields(); setEditingRoleGroup(group); setEditingRole(role); setRoleDialog(kind);
    roleForm.setFieldsValue(kind === "rename" ? { name: role.name } : kind === "role" ? { roleGroupId: group?.id ?? roleGroups.data?.[0]?.id } : {});
  };
  const openRoleGroupRename = (group: any) => {
    roleForm.resetFields(); setEditingRole(undefined); setEditingRoleGroup(group); setRoleDialog("rename-group");
    roleForm.setFieldsValue({ name: group.name });
  };
  const saveRoleDialog = async () => {
    try {
      const values = await roleForm.validateFields(); setRoleSaving(true);
      if (roleDialog === "group") await api("/admin/role-groups", { method: "POST", body: JSON.stringify(values) });
      else if (roleDialog === "rename-group") await api(`/admin/role-groups/${editingRoleGroup.id}`, { method: "PATCH", body: JSON.stringify({ name: values.name }) });
      else if (roleDialog === "rename") await api(`/admin/roles/${editingRole.id}`, { method: "PATCH", body: JSON.stringify({ name: values.name }) });
      else await api("/admin/roles", { method: "POST", body: JSON.stringify(values) });
      message.success(roleDialog === "group" ? "角色组已创建" : roleDialog === "rename-group" ? "角色组名称已修改" : roleDialog === "rename" ? "角色名称已修改" : "角色已创建");
      setRoleDialog(undefined); setEditingRole(undefined); setEditingRoleGroup(undefined); roleForm.resetFields(); refreshRoles();
    } catch (error) { if (!(error && typeof error === "object" && "errorFields" in error)) message.error((error as Error).message); }
    finally { setRoleSaving(false); }
  };
  const saveMoveRole = async () => {
    if (!moveRole || !moveGroupId) return;
    try { setMoveSaving(true); await api(`/admin/roles/${moveRole.id}`, { method: "PATCH", body: JSON.stringify({ roleGroupId: moveGroupId }) }); message.success("角色分组已调整"); setMoveRole(undefined); refreshRoles(); }
    catch (error) { message.error((error as Error).message); }
    finally { setMoveSaving(false); }
  };
  const deleteRole = (role: any) => setDeleteTarget({ kind: "role", item: role });
  const deleteRoleGroup = (group: any) => setDeleteTarget({ kind: "group", item: group });
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleteSaving(true);
      if (deleteTarget.kind === "role") {
        await api(`/admin/roles/${deleteTarget.item.id}`, { method: "DELETE" });
        message.success("角色已删除");
        if (selectedRoleId === deleteTarget.item.id) setSelectedRoleId(undefined);
        refreshUsers();
      } else {
        await api(`/admin/role-groups/${deleteTarget.item.id}`, { method: "DELETE" });
        message.success("角色组已删除");
      }
      setDeleteTarget(undefined); refreshRoles();
    } catch (error) { message.error((error as Error).message); }
    finally { setDeleteSaving(false); }
  };
  const roleGroupMenu = (group: any) => ({ items: [
    { key: "rename", label: "修改名称" }, { key: "add-role", label: "添加角色" },
    { type: "divider" as const }, { key: "delete", label: <span className="danger-menu-label">删除</span> }
  ], onClick: ({ key }: { key: string }) => {
    if (key === "rename") openRoleGroupRename(group);
    if (key === "add-role") openRoleDialog("role", undefined, group);
    if (key === "delete") deleteRoleGroup(group);
  }});
  const roleMenu = (role: any) => ({ items: [
    { key: "rename", label: "修改名称" }, { key: "move", label: "调整分组" },
    { type: "divider" as const }, { key: "delete", label: <span className="danger-menu-label">删除</span> }
  ], onClick: ({ key }: { key: string }) => {
    if (key === "rename") openRoleDialog("rename", role); if (key === "move") { setMoveRole(role); setMoveGroupId(role.roleGroupId); }
    if (key === "delete") deleteRole(role);
  }});
  const saveRoleMembers = async () => {
    if (!selectedRole) return;
    try { await api(`/admin/roles/${selectedRole.id}`, { method: "PATCH", body: JSON.stringify({ userIds: memberDraft, organizationUnitIds: memberOrganizationDraft }) }); message.success("角色成员已更新"); setMemberDialog(false); refreshRoles(); refreshUsers(); }
    catch (error) { message.error((error as Error).message); }
  };
  const openMemberDialog = () => {
    setMemberDraft(selectedRole?.userIds ?? []); setMemberOrganizationDraft(selectedRole?.organizationUnitIds ?? []); setMemberMode("people"); setMemberSearch(""); setMemberOrganizationId(undefined); setMemberDialog(true);
  };
  const toggleMember = (userId: string, selected: boolean) => setMemberDraft((current) => selected
    ? [...new Set([...current, userId])] : current.filter((id) => id !== userId));
  const memberKeyword = memberSearch.trim().toLocaleLowerCase();
  const enabledMemberCandidates = (directory.data ?? []).filter((user) => user.enabled !== false);
  const searchedMemberCandidates = enabledMemberCandidates.filter((user) => !memberKeyword || [user.displayName, user.employeeNo, user.username, user.mobile]
    .some((value) => String(value ?? "").toLocaleLowerCase().includes(memberKeyword)));
  const organizationMemberCandidates = searchedMemberCandidates.filter((user) => memberOrganizationId && (user.departmentPaths ?? [])
    .some((path: string[]) => organizationMembership.departmentPathBelongsTo(path, memberOrganizationId)));
  const memberIsInherited = (user: any) => userBelongsToAnyOrganization(user, memberOrganizationDraft);
  const memberIsSelected = (user: any) => memberDraft.includes(user.id) || memberIsInherited(user);
  const toggleOrganizationMemberScope = (organizationId: string, selected: boolean) => setMemberOrganizationDraft((current) => selected
    ? [...new Set([...current, organizationId])]
    : current.filter((id) => id !== organizationId));
  const setCandidateSelection = (candidates: any[], selected: boolean) => setMemberDraft((current) => selected
    ? [...new Set([...current, ...candidates.map((user) => user.id)])]
    : current.filter((id) => !candidates.some((user) => user.id === id)));
  const exportMembers = async () => {
    /* 导出使用与服务端同一约束（selectedRoleId + 搜索 + FilterGroup）分页取全量，禁止只导出当前页。 */
    const rows: any[] = [];
    for (let page = 1; page <= 50; page++) {
      const result = await api<PlatformTablePage<any>>(adminUsersUrl({ ...roleMemberQuery, page, pageSize: 200 }, { search: roleMemberSearch, roleId: selectedRoleId }));
      rows.push(...result.rows);
      if (rows.length >= result.total || result.rows.length === 0) break;
    }
    const header = "姓名,编号,所属部门,角色\n"; const csv = header + rows.map((user) => [user.displayName, user.employeeNo || user.username, (user.departmentPaths ?? []).map((path: string[]) => path.at(-1)).join("|"), selectedRole?.name].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
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
          <div className="role-group-title"><span><FolderOutlined /> <Text strong>{group.name}</Text></span><span className="role-group-actions"><HolderOutlined aria-hidden="true" /><Dropdown trigger={["click"]} menu={roleGroupMenu(group)}><Button type="text" aria-label={`编辑角色组-${group.name}`} icon={<MoreOutlined />} onClick={(event) => event.stopPropagation()} /></Dropdown></span></div>
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
      <KdosDataTable resource="users" shellClassName="employee-admin-member-table-shell" className="employee-admin-table employee-admin-member-table" rowKey="id" rowSelection={{ selectedRowKeys: selectedUserIds, onChange: setSelectedUserIds }} dataSource={visibleUsers} loading={departmentMembers.isLoading} columns={userColumns} serverData={{ total: departmentMembers.data?.total ?? 0, onQueryChange: setDepartmentQuery }} printContext={{ departmentId: selectedDepartment ?? "", status }} scroll={{ x: 1750, y: "100%" }} />
    </> : selectedRole ? <>
      <Flex className="employee-admin-title" justify="space-between" align="center"><Title level={3}>{selectedRole.name}</Title><Space split={<span className="role-title-divider" />}><Button type="link" onClick={() => openRoleDialog("rename", selectedRole)}>修改名称</Button><Button type="link" onClick={() => { setMoveRole(selectedRole); setMoveGroupId(selectedRole.roleGroupId); }}>调整分组</Button></Space></Flex>
      <Flex className="employee-admin-toolbar" justify="space-between"><Space><Button type="primary" onClick={openMemberDialog}>添加成员</Button><Button icon={<ImportOutlined />} disabled>导入</Button><Button icon={<ExportOutlined />} onClick={exportMembers}>导出</Button></Space><Input prefix={<SearchOutlined />} allowClear placeholder="搜索成员" value={roleMemberSearch} onChange={(event) => setRoleMemberSearch(event.target.value)} style={{ width: 310 }} /></Flex>
      <KdosDataTable resource="users" className="employee-admin-table" rowKey="id" dataSource={roleMembers} serverData={{ total: roleMembersPage.data?.total ?? 0, onQueryChange: setRoleMemberQuery }} printContext={{ roleId: selectedRoleId ?? "" }} columns={[
        { title: "姓名", dataIndex: "displayName", render: (value: string) => <Space><Avatar className="employee-table-avatar">{initials(value)}</Avatar>{value}</Space> },
        { title: "所属部门", dataIndex: "departmentPaths", render: (paths: string[][]) => (paths ?? []).map((path) => path.at(-1)).join("、") || "—" },
        { title: "分管部门", render: () => (selectedRole.organizationUnitIds ?? []).map((id: string) => organizationMap.get(id)?.name).filter(Boolean).join("、") || "—" },
        { title: "操作", width: 120, render: (_: unknown, user: any) => userBelongsToAnyOrganization(user, selectedRole.organizationUnitIds ?? []) ? <Tag color="blue">部门授权</Tag> : <Button danger type="link" onClick={() => { setMemberDraft((selectedRole.userIds ?? []).filter((id: string) => id !== user.id)); setMemberOrganizationDraft(selectedRole.organizationUnitIds ?? []); setMemberDialog(true); }}>移除</Button> }
      ]} />
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
          {!editingUser && <Form.Item name="password" label="首次密码" rules={[{ required: true, pattern: /^(?=.{8,64}$)(?=.*[A-Za-z])(?=.*\d)\S+$/, message: "8–64 位，包含字母和数字且不能包含空格" }]} className="employee-form-wide"><Input.Password /></Form.Item>}
          <Form.Item name="enabled" label="账号状态" className="employee-form-wide"><Select options={[{ value: true, label: "已启用" }, { value: false, label: "已停用" }]} /></Form.Item>
        </div>
      </Form>
    </Drawer>

    <Modal title={action?.kind === "HANDOVER" ? "交接工作" : "转移部门"} open={Boolean(action)} onCancel={() => setAction(undefined)} onOk={() => action && actionValue && void performEmployeeAction(action.user, action.kind, action.kind === "HANDOVER" ? { targetUserId: actionValue } : { departmentPaths: [unitPath(actionValue)] })} okButtonProps={{ disabled: !actionValue }}>
      <Form layout="vertical"><Form.Item label={action?.kind === "HANDOVER" ? "选择工作接收人" : "选择转入部门"}>{action?.kind === "HANDOVER" ? <Select showSearch optionFilterProp="label" value={actionValue} onChange={setActionValue} options={(directory.data ?? []).filter((user) => user.enabled && user.id !== action?.user.id).map((user) => ({ value: user.id, label: `${user.displayName}（${user.employeeNo ?? user.username}）` }))} /> : <TreeSelect treeData={organizationTree} treeDefaultExpandAll value={actionValue} onChange={setActionValue} />}</Form.Item></Form>
    </Modal>

    <Modal forceRender confirmLoading={roleSaving} title={roleDialog === "group" ? "创建角色组" : roleDialog === "rename-group" ? "修改角色组名称" : roleDialog === "rename" ? "修改角色名称" : "创建角色"} open={Boolean(roleDialog)} onCancel={() => { setRoleDialog(undefined); setEditingRole(undefined); setEditingRoleGroup(undefined); }} onOk={() => void saveRoleDialog()}>
      <Form form={roleForm} layout="vertical"><Form.Item name="name" label={roleDialog === "group" || roleDialog === "rename-group" ? "角色组名称" : "角色名称"} rules={[{ required: true, whitespace: true }]}><Input /></Form.Item>{roleDialog === "role" && <Form.Item name="roleGroupId" label="所属分组" rules={[{ required: true }]}><Select disabled={Boolean(editingRoleGroup)} options={(roleGroups.data ?? []).map((group) => ({ value: group.id, label: group.name }))} /></Form.Item>}</Form>
    </Modal>
    <Modal title="调整分组" open={Boolean(moveRole)} confirmLoading={moveSaving} onCancel={() => setMoveRole(undefined)} onOk={() => void saveMoveRole()} okButtonProps={{ disabled: !moveGroupId }}>
      <Text type="secondary">请选择目标分组</Text><div className="role-group-picker">{(roleGroups.data ?? []).map((group) => <button key={group.id} className={moveGroupId === group.id ? "active" : ""} onClick={() => setMoveGroupId(group.id)}><span><FolderOutlined />{group.name}</span>{moveGroupId === group.id && <CheckCircleFilled />}</button>)}</div>
    </Modal>
    <Modal className="role-member-modal" width={960} title="添加成员" open={memberDialog} okText="确定" onCancel={() => setMemberDialog(false)} onOk={() => void saveRoleMembers()}>
      <div className="role-member-selected">{memberDraft.length || memberOrganizationDraft.length ? <>{memberOrganizationDraft.map((id) => <Tag color="blue" key={`organization-${id}`} closable onClose={() => toggleOrganizationMemberScope(id, false)} icon={<ApartmentOutlined />}>{organizationMap.get(id)?.name ?? "未知部门"}</Tag>)}{memberDraft.map((id) => {
        const user = enabledMemberCandidates.find((candidate) => candidate.id === id); if (!user) return null;
        return <Tag key={id} closable onClose={() => toggleMember(id, false)} icon={<Avatar size={22}>{initials(user.displayName)}</Avatar>}>{user.displayName}</Tag>;
      })}</> : <Text type="secondary">尚未选择成员或部门</Text>}</div>
      <Input className="role-member-search" allowClear prefix={<SearchOutlined />} placeholder="搜索（多个关键词用空格隔开）" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} />
      <Tabs activeKey={memberMode} onChange={(key) => setMemberMode(key as "people" | "organization")} items={[
        { key: "people", label: "按人员添加", children: <div className="role-member-people-list">
          <Flex justify="space-between" align="center"><Text strong>全部成员</Text><Checkbox indeterminate={searchedMemberCandidates.some((user) => memberDraft.includes(user.id)) && !searchedMemberCandidates.every((user) => memberDraft.includes(user.id))} checked={searchedMemberCandidates.length > 0 && searchedMemberCandidates.every((user) => memberDraft.includes(user.id))} onChange={(event) => setCandidateSelection(searchedMemberCandidates, event.target.checked)}>全选结果</Checkbox></Flex>
          {searchedMemberCandidates.map((user) => <label key={user.id} className="role-member-person"><Space><Avatar>{initials(user.displayName)}</Avatar><span><Text strong>{user.displayName}（{user.employeeNo ?? user.username}）</Text><Text type="secondary">{(user.departmentPaths ?? []).map((path: string[]) => path.join(" / ")).join("、") || "未分配部门"}</Text></span></Space><Checkbox checked={memberIsSelected(user)} disabled={memberIsInherited(user)} onChange={(event) => toggleMember(user.id, event.target.checked)} /></label>)}
        </div> },
        { key: "organization", label: "按组织添加", children: <div className="role-member-organization">
          <div className="role-member-organization-tree"><Text strong>组织架构</Text><Tree showIcon blockNode defaultExpandAll treeData={organizationTree} selectedKeys={memberOrganizationId ? [memberOrganizationId] : []} onSelect={(keys) => setMemberOrganizationId(String(keys[0] ?? "") || undefined)} /></div>
          <div className="role-member-organization-users"><Flex justify="space-between" align="center"><Text strong>{memberOrganizationId ? `${organizationMap.get(memberOrganizationId)?.name ?? "所选部门"}成员` : "请选择左侧部门"}</Text>{memberOrganizationId && <Checkbox checked={memberOrganizationDraft.includes(memberOrganizationId)} onChange={(event) => toggleOrganizationMemberScope(memberOrganizationId, event.target.checked)}>按部门动态授权</Checkbox>}</Flex>
            {organizationMemberCandidates.map((user) => <label key={user.id} className="role-member-person"><Space><Avatar>{initials(user.displayName)}</Avatar><Text strong>{user.displayName}</Text></Space><Checkbox checked={memberIsSelected(user)} disabled={memberIsInherited(user)} onChange={(event) => toggleMember(user.id, event.target.checked)} /></label>)}
            {memberOrganizationId && !organizationMemberCandidates.length && <Text type="secondary">该部门没有符合条件的在职成员</Text>}
          </div>
        </div> }
      ]} />
    </Modal>
    <Modal title={deleteTarget?.kind === "role" ? `删除角色“${deleteTarget.item.name}”？` : `删除角色组“${deleteTarget?.item.name ?? ""}”？`} open={Boolean(deleteTarget)} confirmLoading={deleteSaving} okText="删除" okButtonProps={{ danger: true }} onCancel={() => setDeleteTarget(undefined)} onOk={() => void confirmDelete()}>
      <Text>{deleteTarget?.kind === "role" ? "该角色与用户的关联及权限配置会一并删除。" : "只能删除不包含角色的空角色组；组内角色不会被自动删除。"}</Text>
    </Modal>
  </div>;
}

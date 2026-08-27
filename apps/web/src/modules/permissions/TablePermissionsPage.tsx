import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  presetPermissionGroupTypes, presetTablePermissionMatrix, tablePermissionActions, tablePermissionFieldsFor,
  tableResourceRegistry, type PresetPermissionGroupType, type TablePermissionAction,
  type TablePermissionFieldDefinition, type TableResourceCode
} from "@kdos/contracts";
import { ApartmentOutlined, ArrowLeftOutlined, CopyOutlined, DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined, SearchOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Avatar, Button, Card, Checkbox, Dropdown, Empty, Flex, Input, InputNumber, Modal, Select, Space, Switch, Tabs, Tag, Tree, Typography, message } from "antd";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";

const { Paragraph, Text, Title } = Typography;
type SubjectType = "USER" | "ORGANIZATION" | "ROLE";
type Subject = { type: SubjectType; id: string };
type PermissionRecord = Record<string, unknown> & {
  resource: string; fieldKey: string; read: boolean; create: boolean; copy: boolean; update: boolean;
  delete: boolean; batchPrint: boolean; batchUpdate: boolean; import: boolean; export: boolean;
};
type PermissionRule = { fieldKey: string; operator: string; value: unknown; fieldType?: string };
type PermissionGroup = {
  id: string; resource: string; groupType: PresetPermissionGroupType | "CUSTOM"; displayName: string;
  description?: string | null; enabled: boolean; dataScope: string; dataMatch: "ALL" | "ANY";
  dataRules: PermissionRule[]; permissions: PermissionRecord[]; subjects: Subject[]; version: number;
};
type Role = { id: string; name: string; roleGroupId?: string | null; permissions?: PermissionRecord[] };
type RoleGroup = { id: string; name: string };
type User = { id: string; displayName: string; employeeNo?: string | null; username: string; enabled: boolean; departmentPaths?: string[][] };
type Organization = { id: string; name: string; parentId?: string | null; enabled: boolean; level: number };

const actionField: Record<TablePermissionAction, keyof PermissionRecord> = {
  read: "read", create: "create", copy: "copy", update: "update", delete: "delete",
  batch_print: "batchPrint", batch_update: "batchUpdate", import: "import", export: "export"
};
const actionLabel: Record<TablePermissionAction, string> = {
  read: "查看", create: "添加", copy: "复制", update: "编辑", delete: "删除",
  batch_print: "批量打印", batch_update: "批量修改", import: "导入", export: "导出"
};
const presetLabel: Record<PresetPermissionGroupType, string> = {
  ADD_ONLY: "仅添加数据", ADD_MANAGE_OWN: "添加并管理本人数据", ADD_VIEW_ALL: "添加并查看全部数据",
  MANAGE_ALL: "管理全部数据", VIEW_ALL: "查看全部数据"
};
const scopeLabel: Record<string, string> = { NONE: "仅提交数据", OWN: "本人创建的数据", ALL: "全部数据", CUSTOM: "按筛选条件" };
function safeReturnPath() { const value = new URLSearchParams(window.location.search).get("from"); return value?.startsWith("/") && !value.startsWith("/permissions/") ? value : "/"; }
function actionsFromPermission(permission?: PermissionRecord) { return permission ? tablePermissionActions.filter((action) => Boolean(permission[actionField[action]])) : []; }
function presetActions(type: PresetPermissionGroupType) { return tablePermissionActions.filter((action) => presetTablePermissionMatrix[type][action]); }
function subjectKey(subject: Subject) { return `${subject.type}:${subject.id}`; }

export function TablePermissionsPage({ resourceCode }: { resourceCode: string }) {
  const queryClient = useQueryClient();
  const resource = tableResourceRegistry.find((entry) => entry.code === resourceCode);
  const groups = useQuery({ queryKey: ["table-permission-groups", resourceCode], queryFn: () => api<PermissionGroup[]>(`/admin/table-permission-groups?resource=${encodeURIComponent(resourceCode)}`), enabled: Boolean(resource), staleTime: 0 });
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<Role[]>("/admin/roles"), enabled: Boolean(resource), staleTime: 0 });
  const roleGroups = useQuery({ queryKey: ["admin-role-groups"], queryFn: () => api<RoleGroup[]>("/admin/role-groups"), enabled: Boolean(resource) });
  const users = useQuery({ queryKey: ["admin-users", "permission-page"], queryFn: () => api<User[]>("/admin/users"), enabled: Boolean(resource) });
  const organizations = useQuery({ queryKey: ["organization-units"], queryFn: () => api<Organization[]>("/admin/organization-units"), enabled: Boolean(resource) });
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorFromEditor, setSelectorFromEditor] = useState(false);
  const [selectorTab, setSelectorTab] = useState<"organization" | "role" | "member">("organization");
  const [selectorSearch, setSelectorSearch] = useState("");
  const [activeOrganization, setActiveOrganization] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(null);
  const [permissionChoice, setPermissionChoice] = useState<string>("VIEW_ALL");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [customActions, setCustomActions] = useState<TablePermissionAction[]>(["read"]);
  const [customFields, setCustomFields] = useState<Record<string, { visible: boolean; editable: boolean }>>({});
  const [fieldSearch, setFieldSearch] = useState("");
  const [dataMatch, setDataMatch] = useState<"ALL" | "ANY">("ALL");
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [customTab, setCustomTab] = useState("identity");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const roleGroupMap = useMemo(() => new Map((roleGroups.data ?? []).map((group) => [group.id, group.name])), [roleGroups.data]);
  const roleName = (role: Role) => role.roleGroupId && roleGroupMap.get(role.roleGroupId) ? `${roleGroupMap.get(role.roleGroupId)}-${role.name}` : role.name;
  const userMap = useMemo(() => new Map((users.data ?? []).map((user) => [user.id, user])), [users.data]);
  const organizationMap = useMemo(() => new Map((organizations.data ?? []).map((unit) => [unit.id, unit])), [organizations.data]);
  const roleMap = useMemo(() => new Map((roles.data ?? []).map((role) => [role.id, role])), [roles.data]);
  const fields = useMemo(() => resource ? tablePermissionFieldsFor(resource.code as TableResourceCode) : [], [resource]);
  const organizationPath = (id: string) => { const path: string[] = []; let current = organizationMap.get(id); const visited = new Set<string>(); while (current && !visited.has(current.id)) { visited.add(current.id); path.unshift(current.name); current = current.parentId ? organizationMap.get(current.parentId) : undefined; } return path; };
  const usersInOrganization = (organizationId: string | null) => { if (!organizationId) return (users.data ?? []).filter((user) => user.enabled); const path = organizationPath(organizationId); return (users.data ?? []).filter((user) => user.enabled && (user.departmentPaths ?? []).some((candidate) => path.every((name, index) => candidate[index] === name))); };
  const treeData = useMemo(() => { const units = (organizations.data ?? []).filter((unit) => unit.enabled); const build = (parentId: string | null): any[] => units.filter((unit) => (unit.parentId ?? null) === parentId).map((unit) => ({ key: unit.id, title: unit.name, icon: <ApartmentOutlined />, children: build(unit.id) })); return build(null); }, [organizations.data]);
  const filteredUsers = usersInOrganization(activeOrganization).filter((user) => !selectorSearch.trim() || `${user.displayName} ${user.employeeNo ?? ""} ${user.username}`.toLowerCase().includes(selectorSearch.trim().toLowerCase()));
  const filteredRoles = (roles.data ?? []).filter((role) => !selectorSearch.trim() || roleName(role).toLowerCase().includes(selectorSearch.trim().toLowerCase()));
  const groupedRoles = [...(roleGroups.data ?? []).map((group) => ({ group, roles: filteredRoles.filter((role) => role.roleGroupId === group.id) })), { group: { id: "ungrouped", name: "未分组" }, roles: filteredRoles.filter((role) => !role.roleGroupId) }].filter((entry) => entry.roles.length);
  const selectedKeys = new Set(subjects.map(subjectKey));
  if (!resource) return <Card><Empty description={`未知表单资源：${resourceCode}`} /><Button href={safeReturnPath()}>返回</Button></Card>;

  const resetDraft = () => { setSubjects([]); setEditingGroup(null); setPermissionChoice("VIEW_ALL"); setDisplayName(""); setDescription(""); setCustomActions(["read"]); setCustomFields({}); setDataMatch("ALL"); setRules([]); setCustomTab("identity"); setSaveError(null); };
  const startAdd = () => { resetDraft(); setSelectorSearch(""); setSelectorFromEditor(false); setSelectorOpen(true); };
  const startEdit = (group: PermissionGroup) => {
    setEditingGroup(group); setSubjects(group.subjects); setPermissionChoice(group.groupType); setDisplayName(group.displayName); setDescription(group.description ?? "");
    const operation = group.permissions.find((permission) => permission.fieldKey === "*"); setCustomActions(actionsFromPermission(operation));
    setCustomFields(Object.fromEntries(fields.map((field) => { const permission = group.permissions.find((entry) => entry.fieldKey === field.key); return [field.key, { visible: Boolean(permission?.read), editable: Boolean(permission?.update) }]; })));
    setDataMatch(group.dataMatch ?? "ALL"); setRules(group.dataRules ?? []); setCustomTab("identity"); setEditorOpen(true);
  };
  const toggleSubject = (subject: Subject, checked: boolean) => setSubjects((current) => checked ? (current.some((item) => subjectKey(item) === subjectKey(subject)) ? current : [...current, subject]) : current.filter((item) => subjectKey(item) !== subjectKey(subject)));
  const subjectLabel = (subject: Subject) => subject.type === "USER" ? userMap.get(subject.id)?.displayName ?? "未知成员" : subject.type === "ROLE" ? (roleMap.get(subject.id) ? roleName(roleMap.get(subject.id)!) : "未知角色") : organizationMap.get(subject.id)?.name ?? "未知部门";
  const subjectIcon = (type: SubjectType) => type === "USER" ? <UserOutlined /> : type === "ROLE" ? <TeamOutlined /> : <ApartmentOutlined />;
  const confirmSelector = () => { if (!subjects.length) return; setSelectorOpen(false); setEditorOpen(true); setSelectorFromEditor(false); };
  const cancelSelector = () => { setSelectorOpen(false); if (selectorFromEditor) setEditorOpen(true); else resetDraft(); setSelectorFromEditor(false); };
  const reopenSelector = () => { setEditorOpen(false); setSelectorFromEditor(true); setSelectorOpen(true); };
  const selectPermission = (value: string) => { setPermissionChoice(value); if (presetPermissionGroupTypes.includes(value as PresetPermissionGroupType)) setCustomActions(presetActions(value as PresetPermissionGroupType)); if (value === "CUSTOM" && !Object.keys(customFields).length) setCustomFields(Object.fromEntries(fields.map((field) => [field.key, { visible: false, editable: false }]))); };
  const setAction = (action: TablePermissionAction, checked: boolean) => setCustomActions((current) => { let next = checked ? [...new Set([...current, action])] : current.filter((item) => item !== action); if (!checked && action === "read") next = next.filter((item) => !["copy", "update", "delete", "batch_update", "export"].includes(item)); if (checked && ["copy", "update", "delete", "batch_update", "export"].includes(action) && !next.includes("read")) next.push("read"); return next; });
  const setField = (field: TablePermissionFieldDefinition, key: "visible" | "editable", checked: boolean) => setCustomFields((current) => { const value = current[field.key] ?? { visible: false, editable: false }; return { ...current, [field.key]: key === "editable" ? { visible: checked || value.visible, editable: checked } : { visible: checked, editable: checked ? value.editable : false } }; });
  const setAllFields = (key: "visible" | "editable", checked: boolean) => setCustomFields((current) => Object.fromEntries(fields.map((field) => { const value = current[field.key] ?? { visible: false, editable: false }; return [field.key, key === "visible" ? { visible: checked, editable: checked ? value.editable : false } : { visible: checked || value.visible, editable: checked && field.editable }]; })));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["table-permission-groups", resourceCode] }, { throwOnError: true });

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (!subjects.length) throw new Error("请至少选择一个部门、角色或成员");
      if (permissionChoice.startsWith("EXISTING:")) {
        const group = groups.data?.find((item) => item.id === permissionChoice.slice(9)); if (!group) throw new Error("所选自定义权限组不存在");
        const merged = [...new Map([...group.subjects, ...subjects].map((subject) => [subjectKey(subject), subject])).values()];
        await api(`/admin/table-permission-groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ subjects: merged, version: group.version }) });
      } else {
        const groupType = permissionChoice as PresetPermissionGroupType | "CUSTOM";
        if (groupType === "CUSTOM") {
          if (!displayName.trim()) { setCustomTab("identity"); throw new Error("请填写权限组名称"); }
          if (!customActions.length) { setCustomTab("operations"); throw new Error("至少选择一个操作权限"); }
          if (customActions.includes("read") && !Object.values(customFields).some((field) => field.visible)) { setCustomTab("fields"); throw new Error("拥有查看权限时至少选择一个可见字段"); }
          if (customActions.includes("update") && !Object.values(customFields).some((field) => field.editable)) { setCustomTab("fields"); throw new Error("拥有编辑权限时至少选择一个可编辑字段"); }
        }
        const body = { resource: resourceCode, groupType, displayName: groupType === "CUSTOM" || editingGroup ? displayName : undefined, description: groupType === "CUSTOM" ? description : undefined, actions: customActions, fields: fields.map((field) => ({ fieldKey: field.key, ...(customFields[field.key] ?? { visible: false, editable: false }) })), dataMatch, dataRules: rules, subjects };
        if (editingGroup) await api(`/admin/table-permission-groups/${editingGroup.id}`, { method: "PATCH", body: JSON.stringify({ ...body, version: editingGroup.version }) }); else await api("/admin/table-permission-groups", { method: "POST", body: JSON.stringify(body) });
      }
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["admin-roles"] })]);
      message.success(editingGroup ? "权限组已更新" : "成员权限已发布"); setEditorOpen(false); resetDraft();
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "权限保存失败，请稍后重试";
      setSaveError(reason);
      message.error(reason);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const remove = (group: PermissionGroup) => Modal.confirm({ title: `删除权限组“${group.displayName}”？`, content: "删除后，本组带来的成员、部门和角色授权会立即失效，其他权限组不受影响。", okText: "删除", okButtonProps: { danger: true }, onOk: async () => { await api(`/admin/table-permission-groups/${group.id}`, { method: "DELETE" }); message.success("权限组已删除"); await refresh(); } });
  const toggleEnabled = async (group: PermissionGroup, enabled: boolean) => { await api(`/admin/table-permission-groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ enabled, version: group.version }) }); message.success(enabled ? "权限组已启用" : "权限组已停用"); await refresh(); };
  const copyGroup = async (group: PermissionGroup) => { if (group.groupType !== "CUSTOM") return; const suffix = new Date().toLocaleTimeString("zh-CN", { hour12: false }).replaceAll(":", ""); const operation = group.permissions.find((permission) => permission.fieldKey === "*"); await api("/admin/table-permission-groups", { method: "POST", body: JSON.stringify({ resource: resourceCode, groupType: "CUSTOM", displayName: `${group.displayName} 副本${suffix}`, description: group.description, actions: actionsFromPermission(operation), fields: fields.map((field) => { const permission = group.permissions.find((entry) => entry.fieldKey === field.key); return { fieldKey: field.key, visible: Boolean(permission?.read), editable: Boolean(permission?.update) }; }), dataMatch: group.dataMatch, dataRules: group.dataRules, subjects: group.subjects }) }); message.success("权限组已复制"); await refresh(); };

  const legacyRolePermissions = (roles.data ?? []).flatMap((role) => { const permission = role.permissions?.find((item) => item.resource === resourceCode && item.fieldKey === "*"); return permission && actionsFromPermission(permission).length ? [{ role, permission }] : []; });
  const visibleFields = fields.filter((field) => !fieldSearch.trim() || field.label.toLowerCase().includes(fieldSearch.trim().toLowerCase()));
  const visibleCount = fields.filter((field) => customFields[field.key]?.visible).length;
  const editableCandidates = fields.filter((field) => field.editable);
  const editableCount = editableCandidates.filter((field) => customFields[field.key]?.editable).length;
  const permissionOptions = [
    ...(groups.data?.some((group) => group.groupType === "CUSTOM") ? [{ label: "已有自定义权限组", options: groups.data.filter((group) => group.groupType === "CUSTOM").map((group) => ({ value: `EXISTING:${group.id}`, label: group.displayName })) }] : []),
    { label: "系统预置权限", options: presetPermissionGroupTypes.map((type) => ({ value: type, label: presetLabel[type] })) },
    { label: "新建", options: [{ value: "CUSTOM", label: "＋ 新建自定义权限" }] }
  ];

  return <div className="table-permissions-page permission-publish-page">
    <PageHeader title={`对成员发布 · ${resource.label}`} subtitle={`${resource.module} / ${resource.label}`} actions={<Button href={safeReturnPath()} icon={<ArrowLeftOutlined />}>返回原表</Button>} />
    <div className="permission-publish-toolbar"><Button type="primary" size="large" icon={<PlusOutlined />} onClick={startAdd}>添加成员</Button>{(groups.data?.length ?? 0) > 0 && <Button danger type="text" onClick={() => Modal.confirm({ title: "停用全部权限组？", content: "只停用当前表单的权限组，不影响其他表单。", onOk: async () => { for (const group of groups.data ?? []) if (group.enabled) await toggleEnabled(group, false); } })}>停用全部</Button>}</div>
    {(groups.data?.length ?? 0) > 0 ? <div className="permission-publish-list">{groups.data!.map((group) => { const operation = group.permissions.find((permission) => permission.fieldKey === "*"); return <section className={`permission-publish-card ${group.enabled ? "" : "disabled"}`} key={group.id}>
      <div className="permission-publish-card-head"><div><Title level={5}>{group.displayName}</Title><Text type="secondary">{group.description || `${scopeLabel[group.dataScope] ?? group.dataScope}；${actionsFromPermission(operation).map((action) => actionLabel[action]).join("、")}`}</Text></div><Space split={<span className="permission-card-divider" />}>
        <Button type="link" icon={<EditOutlined />} onClick={() => startEdit(group)}>编辑</Button>{group.groupType === "CUSTOM" && <Button type="link" icon={<CopyOutlined />} onClick={() => void copyGroup(group)}>复制</Button>}
        <Dropdown menu={{ items: [{ key: "members", label: "调整成员", onClick: () => { startEdit(group); setTimeout(reopenSelector, 0); } }, { key: "toggle", label: group.enabled ? "停用" : "启用", onClick: () => void toggleEnabled(group, !group.enabled) }] }}><Button type="link">其他设置</Button></Dropdown>
        <Button danger type="link" icon={<DeleteOutlined />} onClick={() => remove(group)}>删除</Button><Switch checked={group.enabled} onChange={(checked) => void toggleEnabled(group, checked)} />
      </Space></div><div className="permission-publish-subjects">{group.subjects.map((subject) => <Tag key={subjectKey(subject)} icon={subjectIcon(subject.type)}>{subjectLabel(subject)}</Tag>)}</div>
    </section>; })}</div> : <div className="permission-publish-empty" />}
    {legacyRolePermissions.length > 0 && <section className="permission-legacy-section"><Text strong>已有角色继承权限</Text><Paragraph type="secondary">以下角色原有权限继续生效，可通过“添加成员”建立新的独立权限组。</Paragraph><Space wrap>{legacyRolePermissions.map(({ role, permission }) => <Tag key={role.id} color="geekblue">{roleName(role)}：{actionsFromPermission(permission).map((action) => actionLabel[action]).join("、")}</Tag>)}</Space></section>}

    <Modal className="permission-subject-selector" width={1000} title="部门成员列表" open={selectorOpen} onCancel={cancelSelector} footer={<Flex justify="space-between"><Button>通讯录</Button><Space><Button onClick={cancelSelector}>取消</Button><Button type="primary" disabled={!subjects.length} onClick={confirmSelector}>确定</Button></Space></Flex>} destroyOnHidden>
      <div className="permission-selected-subjects">{subjects.map((subject) => <div className="permission-selected-chip" key={subjectKey(subject)}><Avatar size={28} icon={subjectIcon(subject.type)} />{subjectLabel(subject)}<Button type="text" size="small" onClick={() => toggleSubject(subject, false)}>×</Button></div>)}</div>
      <Input size="large" allowClear prefix={<SearchOutlined />} value={selectorSearch} onChange={(event) => setSelectorSearch(event.target.value)} placeholder="搜索（多个关键词用空格隔开）" />
      <Tabs activeKey={selectorTab} onChange={(key) => setSelectorTab(key as typeof selectorTab)} items={[
        { key: "organization", label: "组织架构", children: <div className="permission-selector-list"><Tree blockNode checkable checkStrictly showIcon defaultExpandAll treeData={treeData} checkedKeys={{ checked: subjects.filter((subject) => subject.type === "ORGANIZATION").map((subject) => subject.id), halfChecked: [] }} onCheck={(keys) => { const ids = new Set((Array.isArray(keys) ? keys : keys.checked).map(String)); setSubjects((current) => [...current.filter((subject) => subject.type !== "ORGANIZATION"), ...(organizations.data ?? []).filter((unit) => ids.has(unit.id)).map((unit) => ({ type: "ORGANIZATION" as const, id: unit.id }))]); }} /></div> },
        { key: "role", label: "角色", children: <div className="permission-selector-list">{groupedRoles.map(({ group, roles: groupRoles }) => { const allSelected = groupRoles.every((role) => selectedKeys.has(`ROLE:${role.id}`)); const partiallySelected = groupRoles.some((role) => selectedKeys.has(`ROLE:${role.id}`)); return <div className="permission-role-group" key={group.id}><label className="permission-selector-row group"><span><FolderOutlined />{group.name}</span><Checkbox checked={allSelected} indeterminate={partiallySelected && !allSelected} onChange={(event) => { const ids = new Set(groupRoles.map((role) => role.id)); setSubjects((current) => event.target.checked ? [...current.filter((subject) => subject.type !== "ROLE" || !ids.has(subject.id)), ...groupRoles.map((role) => ({ type: "ROLE" as const, id: role.id }))] : current.filter((subject) => subject.type !== "ROLE" || !ids.has(subject.id))); }} /></label>{groupRoles.map((role) => <label className="permission-selector-row child" key={role.id}><span><Avatar icon={<TeamOutlined />} />{role.name}</span><Checkbox checked={selectedKeys.has(`ROLE:${role.id}`)} onChange={(event) => toggleSubject({ type: "ROLE", id: role.id }, event.target.checked)} /></label>)}</div>; })}</div> },
        { key: "member", label: "成员", children: <div className="permission-member-selector"><div className="permission-member-organizations"><Button type={activeOrganization ? "text" : "primary"} block onClick={() => setActiveOrganization(null)}>全部成员</Button><Tree blockNode showIcon defaultExpandAll treeData={treeData} selectedKeys={activeOrganization ? [activeOrganization] : []} onSelect={(keys) => setActiveOrganization(keys[0] ? String(keys[0]) : null)} /></div><div className="permission-member-results"><div className="permission-member-result-head"><Text type="success">已选 {subjects.filter((subject) => subject.type === "USER").length}/{filteredUsers.length}</Text><Checkbox checked={filteredUsers.length > 0 && filteredUsers.every((user) => selectedKeys.has(`USER:${user.id}`))} indeterminate={filteredUsers.some((user) => selectedKeys.has(`USER:${user.id}`)) && !filteredUsers.every((user) => selectedKeys.has(`USER:${user.id}`))} onChange={(event) => { const ids = new Set(filteredUsers.map((user) => user.id)); setSubjects((current) => event.target.checked ? [...current.filter((subject) => subject.type !== "USER" || !ids.has(subject.id)), ...filteredUsers.map((user) => ({ type: "USER" as const, id: user.id }))] : current.filter((subject) => subject.type !== "USER" || !ids.has(subject.id))); }} /></div>{filteredUsers.map((user) => <label className="permission-selector-row" key={user.id}><span><Avatar>{user.displayName.slice(0, 1)}</Avatar><span>{user.displayName}<small>{user.employeeNo ?? user.username}</small></span></span><Checkbox checked={selectedKeys.has(`USER:${user.id}`)} onChange={(event) => toggleSubject({ type: "USER", id: user.id }, event.target.checked)} /></label>)}</div></div> }
      ]} />
    </Modal>

    <Modal className="permission-member-editor" width={1000} title={editingGroup ? "编辑成员权限" : "添加成员"} open={editorOpen} confirmLoading={saving} okButtonProps={{ disabled: saving }} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} onCancel={() => { if (savingRef.current) return; setEditorOpen(false); resetDraft(); }} onOk={() => void save()} okText="确定" cancelText="取消" destroyOnHidden>
      <Text strong className="permission-editor-heading">对成员发布</Text><button type="button" className="permission-editor-subject-box" onClick={reopenSelector}>{subjects.map((subject) => <Tag key={subjectKey(subject)} icon={subjectIcon(subject.type)}>{subjectLabel(subject)}</Tag>)}<Text type="secondary">点击重新选择</Text></button>
      <Text strong className="permission-editor-heading">成员权限</Text><Select size="large" value={permissionChoice} onChange={selectPermission} options={permissionOptions} className="permission-type-select" />
      {editingGroup && editingGroup.groupType !== "CUSTOM" && <Input className="permission-preset-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="权限组显示名称" />}
      {permissionChoice === "CUSTOM" && <div className="permission-custom-editor"><Tabs tabPosition="left" activeKey={customTab} onChange={setCustomTab} items={[
        { key: "identity", label: "名称信息", children: <div className="permission-custom-panel"><Text type="secondary">可设置权限组名称和描述信息</Text><Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="填写权限组名称" maxLength={100} /><Input.TextArea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="填写描述信息" rows={8} maxLength={500} /></div> },
        { key: "operations", label: "操作权限", children: <div className="permission-custom-panel"><Text type="secondary">可对表格和数据进行哪些操作</Text><div className="permission-operation-grid"><Checkbox indeterminate={customActions.length > 0 && customActions.length < tablePermissionActions.length} checked={customActions.length === tablePermissionActions.length} onChange={(event) => setCustomActions(event.target.checked ? [...tablePermissionActions] : [])}>全选</Checkbox>{tablePermissionActions.map((action) => <Checkbox key={action} checked={customActions.includes(action)} onChange={(event) => setAction(action, event.target.checked)}>{actionLabel[action]}</Checkbox>)}</div></div> },
        { key: "fields", label: "字段权限", children: <div className="permission-custom-panel permission-field-panel"><Flex justify="space-between" align="center"><Text type="secondary">可以查看和编辑数据的哪些字段</Text><Input allowClear prefix={<SearchOutlined />} value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="搜索" /></Flex><div className="permission-field-table"><div className="permission-field-row header"><span>字段</span><span>可见</span><span>可编辑</span></div><div className="permission-field-row all"><button type="button" onClick={() => setAllFields("visible", visibleCount !== fields.length)}>全选</button><Checkbox checked={visibleCount === fields.length} indeterminate={visibleCount > 0 && visibleCount < fields.length} onChange={(event) => setAllFields("visible", event.target.checked)} /><Checkbox checked={editableCount === editableCandidates.length && editableCandidates.length > 0} indeterminate={editableCount > 0 && editableCount < editableCandidates.length} onChange={(event) => setAllFields("editable", event.target.checked)} /></div><div className="permission-field-scroll">{visibleFields.map((field) => <div className="permission-field-row" key={field.key}><span>{field.required && <b>*</b>}{field.label}</span><Checkbox checked={customFields[field.key]?.visible} onChange={(event) => setField(field, "visible", event.target.checked)} /><Checkbox disabled={!field.editable} checked={customFields[field.key]?.editable} onChange={(event) => setField(field, "editable", event.target.checked)} /></div>)}</div></div></div> },
        { key: "data", label: "数据权限", children: <div className="permission-custom-panel permission-data-panel"><Text type="secondary">可以管理哪些数据</Text><div className="permission-data-match">筛选出符合以下 <Select value={dataMatch} onChange={setDataMatch} options={[{ value: "ALL", label: "所有" }, { value: "ANY", label: "任意一个" }]} /> 条件的数据</div><Button type="link" icon={<PlusOutlined />} onClick={() => setRules((current) => [...current, { fieldKey: "", operator: "EQ", value: "" }])}>添加过滤条件</Button>{rules.map((rule, index) => <RuleEditor key={index} rule={rule} fields={fields} users={users.data ?? []} organizations={organizations.data ?? []} onChange={(next) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}{!rules.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未添加条件时，数据范围为当前表单全部数据" />}</div> }
      ]} /></div>}
      {permissionChoice.startsWith("EXISTING:") && <div className="permission-existing-hint">选中的成员、部门和角色将追加到已有自定义权限组，不会重复创建权限组。</div>}
      {saveError && <Alert className="permission-save-error" type="error" showIcon message="保存失败" description={saveError} role="alert" />}
    </Modal>
  </div>;
}

function RuleEditor({ rule, fields, users, organizations, onChange, onRemove }: { rule: PermissionRule; fields: TablePermissionFieldDefinition[]; users: User[]; organizations: Organization[]; onChange: (rule: PermissionRule) => void; onRemove: () => void }) {
  const field = fields.find((item) => item.key === rule.fieldKey);
  const operatorOptions = field?.type === "number" || field?.type === "date" ? [{ value: "EQ", label: "等于" }, { value: "NE", label: "不等于" }, { value: "GT", label: "大于" }, { value: "GTE", label: "大于等于" }, { value: "LT", label: "小于" }, { value: "LTE", label: "小于等于" }, { value: "IS_EMPTY", label: "为空" }, { value: "IS_NOT_EMPTY", label: "不为空" }] : [{ value: "EQ", label: "等于" }, { value: "NE", label: "不等于" }, { value: "CONTAINS", label: "包含" }, { value: "NOT_CONTAINS", label: "不包含" }, { value: "IN", label: "等于任意一个" }, { value: "IS_EMPTY", label: "为空" }, { value: "IS_NOT_EMPTY", label: "不为空" }];
  const valueDisabled = ["IS_EMPTY", "IS_NOT_EMPTY"].includes(rule.operator);
  let valueEditor = <Input disabled={!field || valueDisabled} value={String(rule.value ?? "")} onChange={(event) => onChange({ ...rule, value: event.target.value })} placeholder="请输入条件值" />;
  if (field?.type === "number") valueEditor = <InputNumber disabled={valueDisabled} value={typeof rule.value === "number" ? rule.value : null} onChange={(value) => onChange({ ...rule, value })} placeholder="请输入数值" /> as any;
  if (field?.type === "date") valueEditor = <Input type="date" disabled={valueDisabled} value={String(rule.value ?? "")} onChange={(event) => onChange({ ...rule, value: event.target.value })} />;
  if (field?.type === "member") valueEditor = <Select disabled={valueDisabled} value={rule.value as string || undefined} onChange={(value) => onChange({ ...rule, value })} options={[{ value: "CURRENT_USER", label: "当前用户" }, ...users.filter((user) => user.enabled).map((user) => ({ value: user.id, label: user.displayName }))]} placeholder="选择成员" />;
  if (field?.type === "department") valueEditor = <Select disabled={valueDisabled} value={rule.value as string || undefined} onChange={(value) => onChange({ ...rule, value })} options={organizations.filter((unit) => unit.enabled).map((unit) => ({ value: unit.id, label: unit.name }))} placeholder="选择部门" />;
  if (field?.type === "boolean") valueEditor = <Select disabled={valueDisabled} value={rule.value as boolean | undefined} onChange={(value) => onChange({ ...rule, value })} options={[{ value: true, label: "是" }, { value: false, label: "否" }]} />;
  return <div className="permission-rule-row"><Select value={rule.fieldKey || undefined} showSearch optionFilterProp="label" onChange={(fieldKey) => onChange({ fieldKey, operator: "EQ", value: "" })} options={fields.map((item) => ({ value: item.key, label: item.label }))} placeholder="请选择字段" /><Select value={rule.operator} onChange={(operator) => onChange({ ...rule, operator, value: ["IS_EMPTY", "IS_NOT_EMPTY"].includes(operator) ? null : rule.value })} options={operatorOptions} />{valueEditor}<Button danger type="text" icon={<DeleteOutlined />} onClick={onRemove} aria-label="删除过滤条件" /></div>;
}

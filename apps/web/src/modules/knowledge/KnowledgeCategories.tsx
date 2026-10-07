import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Space, Switch, Tree } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import type { KnowledgeCategory } from "@kdos/contracts";
import { useKnowledgeCategories } from "./knowledge-ui";
import { api } from "../../api";
import { hasFieldPermission, hasResourcePermission } from "../../shared/KdosDataTable";

export function KnowledgeCategories({ selectedId, onSelect }: { selectedId?: string; onSelect?: (id?: string) => void }) {
  const { message, modal } = App.useApp(); const client = useQueryClient(); const categories = useKnowledgeCategories();
  const lock = useRef(false);
  const [editing, setEditing] = useState<KnowledgeCategory>(); const [parent, setParent] = useState<KnowledgeCategory>(); const [busy, setBusy] = useState(false); const [form] = Form.useForm();
  const canCreate = hasResourcePermission("knowledge-categories", "create"); const canUpdate = hasResourcePermission("knowledge-categories", "update");
  const openCreate = (root: KnowledgeCategory) => { setEditing(undefined); setParent(root); form.setFieldsValue({ name: "", description: "", sortOrder: 0, enabled: true }); };
  const openEdit = (node: KnowledgeCategory) => { setParent(undefined); setEditing(node); form.setFieldsValue(node); };
  const refresh = () => void client.invalidateQueries({ queryKey: ["knowledge"] });
  const save = async () => {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      const values = await form.validateFields(); setBusy(true);
      const payload = editing ? Object.fromEntries(Object.entries(values).filter(([key]) => hasFieldPermission("knowledge-categories", key, "update"))) : values;
      await api(`/knowledge/categories${editing ? `/${editing.id}` : ""}`, { method: editing ? "PATCH" : "POST", body: JSON.stringify(editing ? { ...payload, expectedVersion: editing.version } : { ...payload, parentId: parent?.id }) });
      setParent(undefined); setEditing(undefined); refresh(); message.success("分类已保存");
    } catch (error) { if (error instanceof Error) message.error(error.message); } finally { lock.current = false; setBusy(false); }
  };
  const label = (node: KnowledgeCategory) => <Space size={4}><span>{node.name}{!node.enabled && "（已停用）"}</span>{canUpdate && <Button type="text" size="small" aria-label={`修改分类${node.name}`} icon={<EditOutlined />} onClick={(event) => { event.stopPropagation(); openEdit(node); }} />}</Space>;
  const nodes = (categories.data ?? []).filter((node) => node.level === 1).map((root) => ({ key: root.id, title: label(root), children: [
    ...(categories.data ?? []).filter((node) => node.parentId === root.id).map((child) => ({ key: child.id, title: label(child) })),
    ...(canCreate && root.enabled ? [{ key: `add:${root.id}`, selectable: false, title: <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openCreate(root)}>新增二级分类</Button> }] : [])
  ] }));
  return <aside className="knowledge-category-panel">
    {onSelect && <Button type="text" onClick={() => onSelect(undefined)}>全部知识</Button>}
    {categories.error && <Alert type="error" message={(categories.error as Error).message} />}
    <Tree blockNode defaultExpandAll key={categories.data?.length ?? 0} treeData={nodes} selectedKeys={selectedId ? [selectedId] : []} onSelect={(keys) => { if (!String(keys[0] ?? "").startsWith("add:")) onSelect?.(keys[0] ? String(keys[0]) : undefined); }} />
    <Modal title={editing ? "修改知识分类" : "新增二级分类"} open={Boolean(parent || editing)} onCancel={() => { if (!busy) { setParent(undefined); setEditing(undefined); } }} confirmLoading={busy} onOk={() => void save()} footer={(_, { OkBtn, CancelBtn }) => <Space>
      {editing?.level === 2 && hasResourcePermission("knowledge-categories", "delete") && <Button danger disabled={busy} onClick={() => modal.confirm({ title: `删除分类“${editing.name}”？`, content: "已被文章引用或存在子分类时不能删除。", onOk: async () => { try { await api(`/knowledge/categories/${editing.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: editing.version }) }); setEditing(undefined); refresh(); message.success("分类已删除"); } catch (error) { message.error((error as Error).message); throw error; } } })}>删除分类</Button>}
      <CancelBtn /><OkBtn />
    </Space>}>
      <Form form={form} layout="vertical">
        <Form.Item label="分类名称" name="name" rules={[{ required: true, whitespace: true }, { max: 100 }]}><Input disabled={Boolean(editing && !hasFieldPermission("knowledge-categories", "name", "update"))} /></Form.Item>
        <Form.Item label="说明" name="description"><Input.TextArea maxLength={2000} disabled={Boolean(editing && !hasFieldPermission("knowledge-categories", "description", "update"))} /></Form.Item>
        <Form.Item label="排序" name="sortOrder"><InputNumber precision={0} min={-1000000} max={1000000} disabled={Boolean(editing && !hasFieldPermission("knowledge-categories", "sortOrder", "update"))} /></Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked"><Switch disabled={Boolean(editing && !hasFieldPermission("knowledge-categories", "enabled", "update"))} /></Form.Item>
      </Form>
    </Modal>
  </aside>;
}

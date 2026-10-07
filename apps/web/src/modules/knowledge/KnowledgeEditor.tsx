import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Select, Space, Upload } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { knowledgeVisibilityOptions, type KnowledgeArticle, type KnowledgeAttachment, type KnowledgeVisibility } from "@kdos/contracts";
import { api } from "../../api";
import { hasFieldPermission, hasResourcePermission } from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import { useKnowledgeCategories } from "./knowledge-ui";
import { KnowledgeRichEditor } from "./KnowledgeContent";
import { emptyKnowledgeContent, knowledgeFileUrl, KnowledgeFileContext } from "./knowledge-ui";

type Options = { users: { id: string; label: string }[]; organizations: { id: string; label: string; parentId?: string }[]; roles: { id: string; label: string }[] };
export function KnowledgeEditor() {
  const { id } = useParams(); const navigate = useNavigate(); const { message } = App.useApp(); const client = useQueryClient();
  const [form] = Form.useForm(); const [version, setVersion] = useState(1); const [attachments, setAttachments] = useState<KnowledgeAttachment[]>([]); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const initialized = useRef<string | undefined>(undefined);
  const categories = useKnowledgeCategories(); const existing = useQuery({ queryKey: ["knowledge", "working", id], queryFn: () => api<KnowledgeArticle>(`/knowledge/articles/${id}?mode=manage`), enabled: Boolean(id && hasResourcePermission("knowledge-articles", "read")), retry: false, refetchOnWindowFocus: false, placeholderData: undefined });
  const options = useQuery({ queryKey: ["knowledge", "options"], queryFn: () => api<Options>("/knowledge/options"), enabled: hasResourcePermission("knowledge-articles", id ? "update" : "create") });
  const canSave = hasResourcePermission("knowledge-articles", id ? "update" : "create");
  const readable = (field: string) => !id || hasFieldPermission("knowledge-articles", field, "read");
  const editable = (field: string) => canSave && readable(field) && (field !== "categoryId" || hasResourcePermission("knowledge-categories", "read")) && (!id || hasFieldPermission("knowledge-articles", field, "update"));
  const rootId = Form.useWatch("rootId", form); const visibilityType = Form.useWatch("visibilityType", form) ?? "ALL";
  useEffect(() => {
    if (initialized.current === (id ?? "new")) return;
    if (existing.data && (categories.data || !hasResourcePermission("knowledge-categories", "read"))) {
      initialized.current = id;
      const row = existing.data; const category = categories.data?.find((node) => node.id === row.categoryId);
      setVersion(row.version); setAttachments(row.attachments ?? []);
      form.setFieldsValue({ ...row, categoryId: category?.parentId ? row.categoryId : undefined, rootId: category?.parentId ?? category?.id, visibilityType: row.visibility?.type ?? "ALL", subjectIds: row.visibility?.subjectIds ?? [] });
    } else if (!id && categories.data) { initialized.current = "new"; form.setFieldsValue({ rootId: categories.data.find((node) => node.level === 1 && node.enabled)?.id }); }
  }, [existing.data, categories.data, form, id]);
  const refresh = () => void client.invalidateQueries({ queryKey: ["knowledge"] });
  const save = async (publish = false) => {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      const values = await form.validateFields();
      const categoryId = values.categoryId ?? values.rootId;
      const all = { title: values.title, summary: values.summary ?? "", categoryId, tags: values.tags ?? [], content: values.content ?? emptyKnowledgeContent, visibility: { type: values.visibilityType, subjectIds: values.visibilityType === "ALL" ? [] : values.subjectIds ?? [] } as KnowledgeVisibility, attachmentIds: attachments.map((file) => file.id) };
      const payload = id ? Object.fromEntries(Object.entries(all).filter(([field]) => editable(field))) : all;
      const saved = await api<{ id: string; version: number }>(`/knowledge/articles${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(id ? { ...payload, expectedVersion: version } : payload) });
      setVersion(saved.version);
      if (publish) {
        try { await api(`/knowledge/articles/${saved.id}/publish`, { method: "POST", body: JSON.stringify({ expectedVersion: saved.version }) }); }
        catch (error) { refresh(); navigate(`/knowledge/manage/articles/${saved.id}/edit`, { replace: !id }); throw new Error(`工作副本已保存，发布失败：${(error as Error).message}`); }
      }
      initialized.current = undefined; refresh(); message.success(publish ? "文章已发布" : "工作副本已保存");
      navigate(publish ? `/knowledge/articles/${saved.id}` : `/knowledge/manage/articles/${saved.id}/edit`, { replace: !id });
    } catch (error) { if (error instanceof Error) message.error(error.message); } finally { lock.current = false; setBusy(false); }
  };
  const upload = async (file: File) => {
    if (!id || existing.isLoading || initialized.current !== id || lock.current) return false; lock.current = true; setBusy(true);
    try {
      const body = new FormData(); body.append("file", file); body.append("expectedVersion", String(version));
      const result = await api<{ attachment: KnowledgeAttachment; version: number }>(`/knowledge/articles/${id}/attachments`, { method: "POST", body });
      setAttachments((items) => [...items, result.attachment]); setVersion(result.version); message.success("附件已上传，请保存正文后发布");
    } catch (error) { message.error((error as Error).message); } finally { lock.current = false; setBusy(false); } return false;
  };
  const remove = async (file: KnowledgeAttachment) => {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { const result = await api<{ version: number }>(`/knowledge/articles/${id}/attachments/${file.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: version }) }); setAttachments((items) => items.filter((item) => item.id !== file.id)); setVersion(result.version); }
    catch (error) { message.error((error as Error).message); } finally { lock.current = false; setBusy(false); }
  };
  if (!canSave) return <Alert type="error" message="当前权限组没有文章编辑权限" />;
  if (existing.error) return <Alert type="error" message={(existing.error as Error).message} />;
  const targets = visibilityType === "USER" ? options.data?.users : visibilityType === "ROLE" ? options.data?.roles : options.data?.organizations;
  const rootOptions = (categories.data ?? []).filter((node) => node.level === 1 && node.enabled).map((node) => ({ value: node.id, label: node.name }));
  const childOptions = (categories.data ?? []).filter((node) => node.parentId === rootId && node.enabled).map((node) => ({ value: node.id, label: node.name }));
  const canPublish = hasResourcePermission("knowledge-articles", "update") && hasFieldPermission("knowledge-articles", "status", "update") && ["title", "summary", "categoryId", "content", "tags", "visibility", "attachmentIds"].every((field) => hasFieldPermission("knowledge-articles", field, "read"));
  return <KnowledgeFileContext.Provider value={{ mode: "manage" }}><div className="knowledge-editor-form">
    {existing.data?.publishedVersion && <Alert type="info" message={`当前发布版本 v${existing.data.publishedVersion}。保存工作副本后，员工仍读取原发布版本。`} style={{ marginBottom: 16 }} />}
    <Form form={form} layout="vertical" initialValues={{ content: emptyKnowledgeContent, tags: [], visibilityType: "ALL", subjectIds: [] }} disabled={busy || existing.isLoading && Boolean(id)}>
      <Form.Item label="标题" name="title" rules={[{ required: editable("title"), whitespace: true }, { max: 300 }]}><Input disabled={!editable("title")} /></Form.Item>
      <Form.Item label="摘要" name="summary"><Input.TextArea maxLength={2000} rows={2} disabled={!editable("summary")} /></Form.Item>
      <div className="knowledge-form-grid">
        <Form.Item label="一级分类" name="rootId" rules={[{ required: editable("categoryId") }]}><Select options={rootOptions} disabled={!editable("categoryId")} onChange={() => form.setFieldValue("categoryId", undefined)} /></Form.Item>
        <Form.Item label="二级分类（可选）" name="categoryId"><Select allowClear options={childOptions} disabled={!editable("categoryId")} /></Form.Item>
      </div>
      <Form.Item label="标签" name="tags"><Select mode="tags" tokenSeparators={["，", ","]} disabled={!editable("tags")} /></Form.Item>
      <Form.Item label="正文" name="content"><KnowledgeRichEditor disabled={!editable("content") || busy} attachments={attachments} /></Form.Item>
      <div className="knowledge-form-grid">
        <Form.Item label="可见范围" name="visibilityType"><Select options={knowledgeVisibilityOptions} disabled={!editable("visibility")} onChange={() => form.setFieldValue("subjectIds", [])} /></Form.Item>
        {visibilityType !== "ALL" && <Form.Item label="可见对象" name="subjectIds" rules={[{ required: true, type: "array", min: 1 }]}><Select mode="multiple" showSearch optionFilterProp="label" disabled={!editable("visibility")} options={(targets ?? []).map((target) => ({ value: target.id, label: target.label }))} /></Form.Item>}
      </div>
    </Form>
    {hasFieldPermission("knowledge-articles", "attachmentIds", "read") && <Space direction="vertical" style={{ width: "100%", marginBottom: 16 }}>
      <Upload accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.webp" showUploadList={false} beforeUpload={(file) => upload(file)} disabled={!id || existing.isLoading || busy || !editable("attachmentIds")}><Button disabled={!id || existing.isLoading || busy || !editable("attachmentIds")}>上传附件/图片</Button></Upload>
      {!id && <span>保存草稿后可上传附件和图片。</span>}
      {attachments.map((file) => <Space key={file.id}><Button type="link" onClick={() => void downloadApiFile(knowledgeFileUrl(file.id, { mode: "manage" }), file.originalName).catch((error: Error) => message.error(error.message))}>{file.originalName}</Button>{editable("attachmentIds") && <Button type="text" danger disabled={busy} onClick={() => void remove(file)}>移除</Button>}</Space>)}
    </Space>}
    <Space><Button onClick={() => navigate("/knowledge/manage/articles")}>返回列表</Button><Button type="primary" loading={busy} disabled={Boolean(id && existing.isLoading)} onClick={() => void save()}>保存草稿</Button>{canPublish && <Button disabled={busy || Boolean(id && existing.isLoading)} onClick={() => void save(true)}>{existing.data?.publishedVersion ? "重新发布" : "发布"}</Button>}</Space>
  </div></KnowledgeFileContext.Provider>;
}

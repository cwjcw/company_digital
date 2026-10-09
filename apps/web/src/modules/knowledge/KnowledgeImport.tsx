import { useState } from "react";
import {
  Alert,
  Button,
  Input,
  Modal,
  Space,
  Switch,
  Upload,
} from "antd";
import type {
  KnowledgeAccessEntry,
  KnowledgeImportPreview,
  KnowledgeSpace,
} from "@kdos/contracts";
import { KnowledgeLocationPicker } from "./KnowledgeLocationPicker";
import { KnowledgeAccessFields } from "./KnowledgeAccess";
import { KnowledgeContent } from "./KnowledgeContent";
import { hasFieldPermission } from "../../shared/KdosDataTable";
import { api } from "../../api";
export function KnowledgeImport({
  spaces,
  spaceId,
  parentId,
  onClose,
  onCreated,
}: {
  spaces: KnowledgeSpace[];
  spaceId: string;
  parentId?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [preview, setPreview] = useState<KnowledgeImportPreview>(),
    [space, setSpace] = useState(spaceId),
    [parent, setParent] = useState(parentId ?? ""),
    [title, setTitle] = useState(""),
    [validLocation, setValidLocation] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [restricted, setRestricted] = useState(false),
    [entries, setEntries] = useState<KnowledgeAccessEntry[]>([]);
  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      const body = new FormData();
      body.append("file", file);
      const p = await api<KnowledgeImportPreview>(
        "/knowledge/imports/preview",
        { method: "POST", body },
      );
      setPreview(p);
      setTitle(p.title);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const commit = async () => {
    if (!preview || !validLocation) return;
    setBusy(true);
    setError("");
    try {
      const page = await api<{ id: string }>("/knowledge/imports/commit", {
        method: "POST",
        body: JSON.stringify({
          token: preview.token,
          title,
          spaceId: space,
          parentId: parent || null,
          ...(restricted ? { restricted: true, entries } : {}),
        }),
      });
      onCreated(page.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="从文档导入为在线文章"
      onCancel={onClose}
      closable={!busy}
      maskClosable={!busy}
      onOk={() => void commit()}
      okText="导入为草稿"
      okButtonProps={{ disabled: busy || !validLocation || !preview || !title.trim() }}
      confirmLoading={busy}
      width={760}
    >
      <Alert
        type="info"
        message="支持 DOCX、Markdown、HTML，导入后需手动发布。预览有效期10分钟。"
      />
      {error && <Alert type="error" message={error} />}
      <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
        <Upload
          accept=".docx,.md,.markdown,.html,.htm"
          showUploadList={false}
          beforeUpload={(file) => {
            void upload(file);
            return false;
          }}
          disabled={busy}
        >
          <Button loading={busy}>选择文档并预览</Button>
        </Upload>
        <KnowledgeLocationPicker spaces={spaces} value={{ spaceId: space, parentId: parent || undefined }} disabled={busy}
          onValidityChange={setValidLocation} onChange={(location) => {
            setSpace(location.spaceId); setParent(location.parentId ?? ""); setRestricted(false); setEntries([]);
          }} />
        <Input
          aria-label="导入页面标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="页面标题"
        />
        {spaces.find((s) => s.id === space)?.accessLevel === "FULL_ACCESS" &&
          hasFieldPermission("knowledge-pages", "access", "update") && (
            <>
              <Space>
                <Switch checked={restricted} onChange={setRestricted} />
                <span>
                  {restricted ? "进一步限制页面成员" : "继承目标空间和上级权限"}
                </span>
              </Space>
              {restricted && (
                <KnowledgeAccessFields value={entries} onChange={setEntries} />
              )}
            </>
          )}
        {preview && (
          <>
            <span>图片 {preview.images.length} 张</span>
            {preview.warnings.map((w, i) => (
              <Alert key={i} type="warning" message={w} />
            ))}
            <div className="knowledge-import-preview">
              <KnowledgeContent
                content={JSON.parse(
                  JSON.stringify(preview.content),
                  (key, v) =>
                    key === "content" && Array.isArray(v)
                      ? v.filter((n) => n.type !== "attachmentImage")
                      : v,
                )}
              />
            </div>
          </>
        )}
      </Space>
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import { Alert, App, Button, Input, Space, Tag, Upload } from "antd";
import type { KnowledgeAttachment, KnowledgePage } from "@kdos/contracts";
import { api, ApiError } from "../../api";
import { canPublishKnowledge } from "./knowledge-publish";
import {
  hasFieldPermission,
  hasResourcePermission,
} from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import { KnowledgeFilePreview } from "./KnowledgeFilePreview";
import { KnowledgeRichEditor } from "./KnowledgeContent";
import {
  emptyKnowledgeContent,
  KnowledgeFileContext,
  knowledgeFileUrl,
  knowledgeCanRetry,
} from "./knowledge-ui";
import {
  KnowledgeDraftSession,
  recoverKnowledgeDraft,
  rememberKnowledgeDraft,
} from "./knowledge-autosave";
const labels = {
  saved: "已保存",
  dirty: "等待自动保存",
  saving: "保存中…",
  failed: "保存失败",
  conflict: "版本冲突",
};
export function KnowledgeEditor({
  page,
  onClose,
  onPublished,
  onSession,
}: {
  page: KnowledgePage;
  onClose: () => void;
  onPublished: () => void;
  onSession?: (session: KnowledgeDraftSession | null) => void;
}) {
  const { message, modal } = App.useApp();
  const [busy, setBusy] = useState(false);
  const actionRunning = useRef(false);
  const [hasChanges, setHasChanges] = useState(page.hasUnpublishedChanges === true);
  const [publishError, setPublishError] = useState("");
  const checkedVersion = useRef(page.version);
  const [, render] = useState(0);
  const session = useRef<KnowledgeDraftSession | null>(null);
  if (!session.current)
    session.current =
      recoverKnowledgeDraft(page.id) ??
      new KnowledgeDraftSession(page.version, (payload) =>
        api(`/knowledge/pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        }),
      );
  const draft = session.current;
  const [value, setValue] = useState<KnowledgePage>(() => {
    draft.compareServerVersion(page.version);
    return { ...page, ...draft.recovery() };
  });
  const allowed = (field: string) =>
    page.canEdit &&
    hasResourcePermission("knowledge-pages", "update") &&
    hasFieldPermission("knowledge-pages", field, "read") &&
    hasFieldPermission("knowledge-pages", field, "update");
  useEffect(() => {
    const off = draft.subscribe(() => {
      rememberKnowledgeDraft(page.id, draft);
      render((n) => n + 1);
    });
    onSession?.(draft);
    const unload = (e: BeforeUnloadEvent) => {
      if (draft.hasUnsaved()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      off();
      draft.stop();
      onSession?.(null);
      window.removeEventListener("beforeunload", unload);
      rememberKnowledgeDraft(page.id, draft);
      void draft
        .flush()
        .catch(() => undefined)
        .finally(() => rememberKnowledgeDraft(page.id, draft));
    };
  }, [draft, onSession, page.id]);
  useEffect(() => {
    if (busy || draft.state !== "saved" || draft.isOperating() || draft.version === checkedVersion.current) return;
    const version = draft.version;
    const controller = new AbortController();
    void api<KnowledgePage>(`/knowledge/pages/${page.id}?mode=working`, {
      cache: "no-store", signal: controller.signal,
    }).then((latest) => {
      if (controller.signal.aborted || draft.version !== version) return;
      if (latest.version !== version) {
        draft.compareServerVersion(latest.version);
        return;
      }
      checkedVersion.current = version;
      setPublishError("");
      setHasChanges(latest.hasUnpublishedChanges === true);
    }).catch((e) => {
      if (!controller.signal.aborted) setPublishError((e as Error).message);
    });
    return () => controller.abort();
  }, [busy, draft, draft.state, draft.version, page.id]);
  const change = (patch: Partial<KnowledgePage>) => {
    setValue((v) => ({ ...v, ...patch }));
    draft.changed(patch);
  };
  const upload = async (
    file: File,
    primary = false,
    inline = false,
  ): Promise<KnowledgeAttachment | undefined> => {
    if (busy || !allowed("attachmentIds")) return;
    setBusy(true);
    try {
      const result = await draft.run<{
        attachment: KnowledgeAttachment;
        version: number;
      }>((version) => {
        const body = new FormData();
        body.append("file", file);
        body.append("expectedVersion", String(version));
        body.append(
          "role",
          primary
            ? "PRIMARY"
            : inline
              ? "INLINE"
              : "SUPPLEMENTAL",
        );
        return api(`/knowledge/pages/${page.id}/files`, {
          method: "POST",
          body,
        });
      });
      setValue((v) => ({
        ...v,
        attachments: primary
          ? [
              ...(v.attachments ?? []).filter((f) => f.role !== "PRIMARY"),
              result.attachment,
            ]
          : [...(v.attachments ?? []), result.attachment],
        ...(primary ? { primaryFile: result.attachment } : {}),
      }));
      return result.attachment;
    } catch (e) {
      message.error((e as Error).message);
      return;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (file: KnowledgeAttachment) => {
    setBusy(true);
    try {
      await draft.run((version) =>
        api<{ version: number }>(`/knowledge/files/${file.id}`, {
          method: "DELETE",
          body: JSON.stringify({ expectedVersion: version }),
        }),
      );
      setValue((v) => ({
        ...v,
        attachments: v.attachments?.filter((f) => f.id !== file.id),
      }));
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const finish = async (publish: boolean, close = true) => {
    if (actionRunning.current || busy) return;
    actionRunning.current = true;
    setBusy(true);
    setPublishError("");
    try {
      if (publish) {
        const result = await draft.run(async (version) => {
          const latest = await api<KnowledgePage>(`/knowledge/pages/${page.id}?mode=working`, { cache: "no-store" });
          if (!canPublishKnowledge(latest)) throw new Error("当前没有此页面的发布权限");
          // Keep the editor's serialized lock: adopting another writer's version
          // would silently publish changes that this session did not save.
          if (latest.version !== version) throw new ApiError("页面已被其他用户修改，请保留本地修改并重新加载", 409);
          if (latest.hasUnpublishedChanges === undefined) throw new Error("无法确认最新草稿的发布状态，请刷新后重试");
          if (!latest.hasUnpublishedChanges) return { version, skipped: true };
          return api<{ version: number; skipped?: boolean }>(`/knowledge/pages/${page.id}/publish`, {
            method: "POST",
            body: JSON.stringify({ expectedVersion: version }),
          });
        });
        if (result.skipped) {
          setHasChanges(false);
          message.info("没有未发布修改");
          return;
        }
        message.success("页面已发布");
        onPublished();
      } else {
        await draft.flush();
        if (close) onClose();
        else message.success("已保存");
      }
    } catch (e) {
      setPublishError((e as Error).message);
      message.error((e as Error).message);
    } finally {
      actionRunning.current = false;
      setBusy(false);
    }
  };
  const pendingPublication = hasChanges || draft.hasUnsaved();
  return (
    <KnowledgeFileContext.Provider value={{ mode: "working" }}>
      <div className="knowledge-editor-form">
        <div className="knowledge-editor-actions" role="toolbar" aria-label="页面编辑操作">
          <Space wrap>
            <Button aria-label="保存" disabled={busy || draft.state === "conflict"} loading={busy} onClick={() => void finish(false, false)}>保存</Button>
            {canPublishKnowledge(page) && pendingPublication && (
              <Button aria-label={page.status === "PUBLISHED" ? "发布新版本" : "发布"} type="primary" loading={busy} disabled={draft.state === "conflict"} onClick={() => void finish(true)}>
                {page.status === "PUBLISHED" ? "发布新版本" : "发布"}
              </Button>
            )}
            <Button disabled={busy || draft.state === "conflict"} onClick={() => void finish(false)}>保存并返回</Button>
          <Tag
            color={
              draft.state === "saved"
                ? "green"
                : draft.state === "conflict" || draft.state === "failed"
                  ? "red"
                  : "blue"
            }
          >
            {labels[draft.state]}
          </Tag>

          {page.publishedVersion && (
            <span>已发布 V{page.publishedVersion}{pendingPublication ? " · 有未发布修改" : ""}</span>
          )}
          </Space>
        </div>
        {publishError && <Alert type="error" message={publishError} showIcon />}
        {(draft.state === "failed" || draft.state === "conflict") && (
          <Alert
            type="error"
            message={draft.error}
            description="本地修改已保留，请勿直接关闭页面。"
            action={
              draft.state === "conflict" ? (
                <Button
                  onClick={() =>
                    modal.confirm({
                      title: "重新加载会放弃本地修改，请先复制需要保留的内容。",
                      onOk: () => window.location.reload(),
                    })
                  }
                >
                  重新加载
                </Button>
              ) : (
                <Button
                  onClick={() =>
                    void draft
                      .flush()
                      .catch((e) => message.error((e as Error).message))
                  }
                >
                  重试保存
                </Button>
              )
            }
          />
        )}
        <p className="knowledge-editor-path" aria-label="页面路径">
          {page.breadcrumb
            ?.filter((item) => item.id !== page.id)
            .map((item) => item.title)
            .join(" > ") || page.spaceName}
        </p>
        <Input
          aria-label="页面标题"
          size="large"
          value={value.title}
          maxLength={300}
          disabled={!allowed("title") || busy}
          onChange={(e) => change({ title: e.target.value })}
          style={{ marginBottom: 16 }}
        />
        {value.contentMode === "FILE" &&
          hasFieldPermission("knowledge-pages", "attachmentIds", "read") && (
            <Space
              direction="vertical"
              style={{ width: "100%", marginBottom: 16 }}
            >
              <Upload
                showUploadList={false}
                disabled={!allowed("attachmentIds") || busy}
                accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.txt"
                beforeUpload={(file) => {
                  void upload(file, true);
                  return false;
                }}
              >
                <Button disabled={!allowed("attachmentIds") || busy}>
                  {value.primaryFile ? "替换主文件" : "上传主文件"}
                </Button>
              </Upload>
              {value.primaryFile && (
                <KnowledgeFilePreview
                  key={value.primaryFile.id}
                  file={value.primaryFile}
                  scope={{ mode: "working" }}
                  canRetry={knowledgeCanRetry()}
                />
              )}
            </Space>
          )}
        {value.contentMode !== "FILE" &&
          hasFieldPermission("knowledge-pages", "content", "read") && (
            <KnowledgeRichEditor
              value={value.content ?? emptyKnowledgeContent}
              onChange={(content) => change({ content })}
              disabled={
                !allowed("content") || busy || draft.state === "conflict"
              }
              attachments={value.attachments}
              onPasteImage={(file) => upload(file, false, true)}
            />
          )}
        {hasFieldPermission("knowledge-pages", "description", "read") && (
          <Input.TextArea
            aria-label="页面说明"
            placeholder="简要说明（可选）"
            value={value.description ?? ""}
            maxLength={4000}
            disabled={!allowed("description") || busy}
            onChange={(e) => change({ description: e.target.value })}
            style={{ marginTop: 16, marginBottom: 16 }}
          />
        )}
        {hasFieldPermission("knowledge-pages", "attachmentIds", "read") && (
          <Space direction="vertical" style={{ marginTop: 16 }}>
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                void upload(file);
                return false;
              }}
              disabled={
                !allowed("attachmentIds") || busy || draft.state === "conflict"
              }
            >
              <Button disabled={!allowed("attachmentIds") || busy}>
                上传附件 / 图片
              </Button>
            </Upload>
            {value.attachments
              ?.filter((file) => file.role !== "PRIMARY")
              .map((file) => (
                <Space key={file.id}>
                  <Button
                    type="link"
                    onClick={() =>
                      void downloadApiFile(
                        knowledgeFileUrl(file.id, { mode: "working" }),
                        file.originalName,
                      ).catch((e) => message.error((e as Error).message))
                    }
                  >
                    {file.originalName}
                  </Button>
                  {allowed("attachmentIds") && (
                    <Button
                      danger
                      size="small"
                      disabled={busy}
                      onClick={() => void remove(file)}
                    >
                      移除
                    </Button>
                  )}
                </Space>
              ))}
          </Space>
        )}
      </div>
    </KnowledgeFileContext.Provider>
  );
}

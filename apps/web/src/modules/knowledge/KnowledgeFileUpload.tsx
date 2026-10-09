import { useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Input,
  List,
  Modal,
  Progress,
  Space,
  Upload,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import type { KnowledgeSpace } from "@kdos/contracts";
import { api, ApiError } from "../../api";
import {
  uploadKnowledgeFile,
  type KnowledgeFileUploadInput,
} from "./knowledge-file-upload";
import { KnowledgeLocationPicker } from "./KnowledgeLocationPicker";
export type CreatedKnowledgeFile = { id: string; title: string };
type Entry = {
  id: string;
  file: File;
  title: string;
  status: "waiting" | "uploading" | "done" | "failed";
  progress: number;
  error?: string;
  pageId?: string;
  request?: Readonly<KnowledgeFileUploadInput>;
  locationLabel?: string;
  submitted?: boolean;
  // Once an outcome is unknown, a later rejection cannot prove the first request failed.
  uncertain?: boolean;
};
function requestId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 15) | 64;
  b[8] = (b[8]! & 63) | 128;
  const s = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export function KnowledgeFileUpload({
  spaces,
  spaceId: initial,
  parentId: initialParent,
  onClose,
  onCreated,
}: {
  spaces: KnowledgeSpace[];
  spaceId: string;
  parentId?: string;
  onClose: () => void;
  onCreated: (pages: CreatedKnowledgeFile[]) => void;
}) {
  const { message, modal } = App.useApp();
  const [spaceId, setSpaceId] = useState(initial),
    [parentId, setParentId] = useState(initialParent),
    [validLocation, setValidLocation] = useState(false),
    [locationLabel, setLocationLabel] = useState(""),
    [entries, setEntries] = useState<Entry[]>([]),
    [busy, setBusy] = useState(false),
    [limits, setLimits] = useState({
      maxFileBytes: 100 * 1024 * 1024,
      maxBatchFiles: 20,
    });
  const running = useRef(false),
    leaving = useRef(false),
    queue = useRef(entries);
  queue.current = entries;
  const patch = (id: string, changes: Partial<Entry>) =>
    setEntries((old) =>
      old.map((e) => (e.id === id ? { ...e, ...changes } : e)),
    );
  const run = async () => {
    if (running.current || !validLocation) return;
    const pending = queue.current.filter((e) => e.status !== "done");
    if (pending.some((e) => !e.title.trim() || e.title.trim().length > 300)) {
      message.error("知识页面标题不能为空，且最多300个字符");
      return;
    }
    running.current = true;
    setBusy(true);
    // Capture before any await. Retrying always uses this snapshot and the original File.
    const batch = pending.map((e) => ({
      ...e,
      locationLabel: e.request ? e.locationLabel : locationLabel,
      request:
        e.request ??
        Object.freeze({
          spaceId,
          parentId,
          title: e.title.trim(),
          idempotencyKey: requestId(),
        }),
    }));
    try {
      const current = await api<typeof limits>(
        "/knowledge/files/upload-limits",
      );
      setLimits(current);
      for (const entry of batch) {
        if (entry.file.size > current.maxFileBytes) {
          patch(entry.id, {
            status: "failed",
            error: `文件超过${current.maxFileBytes / 1024 / 1024}MB限制`,
          });
          continue;
        }
        patch(entry.id, {
          request: entry.request,
          locationLabel: entry.locationLabel,
          submitted: true,
          status: "uploading",
          progress: 0,
          error: undefined,
        });
        try {
          const result = await uploadKnowledgeFile(
            entry.file,
            entry.request,
            (p) => patch(entry.id, { progress: p }),
          );
          patch(entry.id, {
            status: "done",
            title: entry.request.title,
            progress: 100,
            pageId: result.id,
          });
        } catch (e) {
          const rejected =
            e instanceof ApiError &&
            [400, 401, 403, 404, 413, 415, 422, 429].includes(e.status);
          patch(entry.id, {
            status: "failed",
            error: (e as Error).message,
            uncertain: entry.uncertain || !rejected,
          });
        }
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const finish = () => {
    const pages = queue.current.flatMap((e) =>
      e.pageId ? [{ id: e.pageId, title: e.title }] : [],
    );
    if (pages.length) onCreated(pages);
    else onClose();
  };
  const complete = () => {
    if (running.current || leaving.current) return;
    if (!queue.current.some((e) => e.status !== "done")) {
      finish();
      return;
    }
    leaving.current = true;
    modal.confirm({
      title: "还有失败或未上传的文件",
      content: "已创建的草稿会保留。可以继续重试，或确认离开并查看已创建页面。",
      okText: "确认离开",
      cancelText: "继续上传 / 重试",
      onOk: () => {
        leaving.current = false;
        finish();
      },
      onCancel: () => {
        leaving.current = false;
      },
    });
  };
  const succeeded = entries.filter((e) => e.status === "done").length,
    failed = entries.filter((e) => e.status === "failed").length;
  return (
    <Modal
      open
      title="上传文件"
      width={700}
      closable={!busy}
      maskClosable={!busy}
      onCancel={complete}
      footer={
        <Space>
          <Button disabled={busy} onClick={complete}>
            完成
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={
              !validLocation || !entries.some((e) => e.status !== "done")
            }
            onClick={() => void run()}
          >
            上传为草稿 / 重试失败项
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        message="每个文件创建一个独立知识草稿，继承目标位置权限；上传成功后后台生成预览，需要手动发布。"
      />
      <KnowledgeLocationPicker
        operation="upload"
        spaces={spaces}
        value={{ spaceId, parentId }}
        disabled={busy}
        onValidityChange={setValidLocation}
        onPathChange={setLocationLabel}
        onChange={(location) => {
          setSpaceId(location.spaceId);
          setParentId(location.parentId);
        }}
      />
      <Upload.Dragger
        multiple
        accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.txt"
        showUploadList={false}
        disabled={busy}
        beforeUpload={(file, fileList) => {
          if (running.current) return Upload.LIST_IGNORE;
          if (entries.length + fileList.length > limits.maxBatchFiles) {
            if (file === fileList[0])
              message.error(
                `一次最多${limits.maxBatchFiles}个文件，请减少后重选`,
              );
            return Upload.LIST_IGNORE;
          }
          setEntries((old) =>
            old.length >= limits.maxBatchFiles
              ? old
              : [
                  ...old,
                  {
                    id: requestId(),
                    file,
                    title: file.name.replace(/\.[^.]+$/, ""),
                    status: "waiting",
                    progress: 0,
                  },
                ],
          );
          return false;
        }}
      >
        <p>
          <InboxOutlined />
        </p>
        <p>拖动文件到这里，或点击选择文件</p>
        <p>
          Word / PPT / PDF / Excel / 图片 / TXT；最多{limits.maxBatchFiles}
          个，每个最多{limits.maxFileBytes / 1024 / 1024}MB
        </p>
      </Upload.Dragger>
      <p role="status">
        成功 {succeeded} 个，失败 {failed} 个，未完成{" "}
        {entries.length - succeeded - failed} 个
      </p>
      <List
        dataSource={entries}
        renderItem={(e) => (
          <List.Item>
            <div style={{ width: "100%" }}>
              <Space wrap>
                <strong>{e.file.name}</strong>
                <span>
                  {e.status === "done"
                    ? "草稿已创建"
                    : e.status === "failed"
                      ? "上传失败"
                      : e.status === "uploading"
                        ? "上传中"
                        : "等待上传"}
                </span>
                {!e.submitted && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (!running.current)
                        setEntries((old) =>
                          old.filter((item) => item.id !== e.id),
                        );
                    }}
                  >
                    移除
                  </Button>
                )}
              </Space>
              <label>
                知识页面标题
                <Input
                  aria-label={`知识页面标题：${e.file.name}`}
                  value={e.title}
                  maxLength={300}
                  disabled={busy || Boolean(e.request) || e.status === "done"}
                  onChange={(event) => {
                    if (!running.current && !e.request)
                      patch(e.id, { title: event.target.value });
                  }}
                />
              </label>
              {e.request && (
                <p>
                  已提交位置：{e.locationLabel}；原请求重试保持该位置和标题。
                </p>
              )}
              <Progress
                percent={e.progress}
                status={
                  e.status === "failed"
                    ? "exception"
                    : e.status === "done"
                      ? "success"
                      : "active"
                }
              />
              {e.error && <Alert type="error" message={e.error} />}
              {e.status === "failed" && e.request && (
                <>
                  <p>
                    {e.uncertain
                      ? "上传结果尚未确认，请重试原请求；文件、标题和保存位置已固定，避免重复创建。"
                      : "请求已明确失败。可重试原请求，或重新发起上传后修改标题及保存位置。"}
                  </p>
                  {!e.uncertain && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        if (!running.current)
                          patch(e.id, {
                            request: undefined,
                            status: "waiting",
                            progress: 0,
                            error: undefined,
                          });
                      }}
                    >
                      重新发起上传
                    </Button>
                  )}
                </>
              )}
            </div>
          </List.Item>
        )}
      />
    </Modal>
  );
}

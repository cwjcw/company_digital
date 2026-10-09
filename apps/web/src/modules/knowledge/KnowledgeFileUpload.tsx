import { useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  List,
  Modal,
  Progress,
  Select,
  Space,
  Upload,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import type { KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { uploadKnowledgeFile } from "./knowledge-file-upload";
import { KnowledgePageSelect } from "./KnowledgePageSelect";
type Entry = {
  id: string;
  file: File;
  status: "waiting" | "uploading" | "done" | "failed";
  progress: number;
  error?: string;
  pageId?: string;
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
  position,
  onClose,
  onCreated,
}: {
  spaces: KnowledgeSpace[];
  spaceId: string;
  parentId?: string;
  position?: string;
  onClose: () => void;
  onCreated: (ids: string[]) => void;
}) {
  const { message } = App.useApp();
  const [spaceId, setSpaceId] = useState(initial),
    [parentId, setParentId] = useState(initialParent),
    [entries, setEntries] = useState<Entry[]>([]),
    [busy, setBusy] = useState(false),
    [limits, setLimits] = useState<{
      maxFileBytes: number;
      maxBatchFiles: number;
    }>({ maxFileBytes: 100 * 1024 * 1024, maxBatchFiles: 20 });
  const running = useRef(false),
    queue = useRef(entries);
  queue.current = entries;
  const patch = (id: string, changes: Partial<Entry>) =>
    setEntries((old) =>
      old.map((e) => (e.id === id ? { ...e, ...changes } : e)),
    );
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const current = await api<typeof limits>(
        "/knowledge/files/upload-limits",
      );
      setLimits(current);
      for (const entry of queue.current.filter((e) => e.status !== "done")) {
        if (entry.file.size > current.maxFileBytes) {
          patch(entry.id, {
            status: "failed",
            error: `文件超过${current.maxFileBytes / 1024 / 1024}MB限制`,
          });
          continue;
        }
        patch(entry.id, { status: "uploading", progress: 0, error: undefined });
        try {
          const result = await uploadKnowledgeFile(
            entry.file,
            { spaceId, parentId, idempotencyKey: entry.id },
            (p) => patch(entry.id, { progress: p }),
          );
          patch(entry.id, { status: "done", progress: 100, pageId: result.id });
        } catch (e) {
          patch(entry.id, { status: "failed", error: (e as Error).message });
        }
      }
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const complete = () => {
    const ids = entries.flatMap((e) => (e.pageId ? [e.pageId] : []));
    if (ids.length) onCreated(ids);
    else onClose();
  };
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
            disabled={!entries.some((e) => e.status !== "done")}
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
      <p>
        目标位置：
        {spaceId === initial && parentId === initialParent && position
          ? position
          : spaces.find((s) => s.id === spaceId)?.name}
        {parentId &&
        !(spaceId === initial && parentId === initialParent && position)
          ? " > 已选父页面"
          : ""}
      </p>
      <Space direction="vertical" style={{ width: "100%", margin: "12px 0" }}>
        <Select
          aria-label="上传目标空间"
          style={{ width: "100%" }}
          value={spaceId}
          disabled={busy || entries.some((e) => e.status === "done")}
          options={spaces
            .filter((s) => s.canCreate)
            .map((s) => ({ value: s.id, label: s.name }))}
          onChange={(id) => {
            setSpaceId(id);
            setParentId(undefined);
          }}
        />
        <KnowledgePageSelect
          disabled={busy || entries.some((e) => e.status === "done")}
          spaceId={spaceId}
          value={parentId}
          onChange={setParentId}
        />
      </Space>
      <Upload.Dragger
        multiple
        accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.txt"
        showUploadList={false}
        disabled={busy}
        beforeUpload={(file, fileList) => {
          if (entries.length + fileList.length > limits.maxBatchFiles) {
            if (file === fileList[0])
              message.error(
                `一次最多${limits.maxBatchFiles}个文件，请减少后重选`,
              );
            return Upload.LIST_IGNORE;
          }
          setEntries((old) => {
            if (old.length >= limits.maxBatchFiles) return old;
            return [
              ...old,
              { id: requestId(), file, status: "waiting", progress: 0 },
            ];
          });
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
      <List
        dataSource={entries}
        renderItem={(e) => (
          <List.Item>
            <div style={{ width: "100%" }}>
              <strong>{e.file.name}</strong>
              <span>
                {" "}
                ·{" "}
                {e.status === "done"
                  ? "草稿已创建"
                  : e.status === "failed"
                    ? "上传失败"
                    : e.status === "uploading"
                      ? "上传中"
                      : "等待上传"}
              </span>
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
            </div>
          </List.Item>
        )}
      />
    </Modal>
  );
}

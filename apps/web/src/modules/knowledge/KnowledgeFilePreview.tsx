import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  InputNumber,
  Progress,
  Select,
  Space,
  Spin,
} from "antd";
import { FullscreenOutlined } from "@ant-design/icons";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  KnowledgeAttachment,
  KnowledgePreviewStatus,
} from "@kdos/contracts";
import { api } from "../../api";
import { downloadApiFile } from "../../shared/legacy-ui";
import { knowledgeFileUrl, type KnowledgeFileScope } from "./knowledge-ui";
GlobalWorkerOptions.workerSrc = workerUrl;
type Status = {
  status: KnowledgePreviewStatus;
  error?: string;
  native: boolean;
  contentType: string;
};
export function KnowledgeFilePreview({
  file,
  scope = {},
  canRetry = false,
}: {
  file: KnowledgeAttachment;
  scope?: KnowledgeFileScope;
  canRetry?: boolean;
}) {
  const { message } = App.useApp();
  const [status, setStatus] = useState<Status>(),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [busy, setBusy] = useState(false),
    [document, setDocument] = useState<PDFDocumentProxy>(),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1),
    [progress, setProgress] = useState(0),
    [objectUrl, setObjectUrl] = useState(""),
    [text, setText] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null);
  const params = new URLSearchParams({ ...scope }).toString();
  const base = `/knowledge/files/${file.id}`,
    suffix = params ? `?${params}` : "";
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus(undefined);
    setError("");
    const poll = async () => {
      try {
        const value = await api<Status>(`${base}/preview-status${suffix}`);
        if (!active) return;
        setStatus(value);
        if (["PENDING", "RUNNING"].includes(value.status))
          timer = setTimeout(() => void poll(), 2000);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, suffix, reload]);
  useEffect(() => {
    if (status?.status !== "SUCCEEDED") return;
    let active = true,
      url = "";
    let task: ReturnType<typeof getDocument> | undefined;
    setDocument(undefined);
    setPage(1);
    setProgress(0);
    setError("");
    setObjectUrl("");
    setText("");
    const load = async () => {
      try {
        if (status.contentType.startsWith("image/")) {
          const blob = await api<Blob>(`${base}/preview${suffix}`);
          url = URL.createObjectURL(blob);
          if (active) setObjectUrl(url);
          return;
        }
        if (status.contentType === "text/plain") {
          const blob = await api<Blob>(`${base}/preview${suffix}`, {
            headers: { Range: "bytes=0-204799" },
          });
          if (active) setText(await blob.text());
          return;
        }
        if (status.native && status.contentType !== "application/pdf") return;
        // Refresh through the existing authenticated API before the PDF transport; no bearer in any URL.
        await api("/auth/me");
        if (!active) return;
        const token = localStorage.getItem("accessToken");
        task = getDocument({
          url: `/api/v1${base}/preview${suffix}`,
          httpHeaders: token ? { Authorization: `Bearer ${token}` } : {},
          disableStream: true,
          disableAutoFetch: true,
          rangeChunkSize: 65536,
        });
        task.onProgress = ({
          loaded,
          total,
        }: {
          loaded: number;
          total: number;
        }) => {
          if (active && total)
            setProgress(Math.min(100, Math.round((100 * loaded) / total)));
        };
        const pdf = await task.promise;
        if (active) {
          setDocument(pdf);
          setProgress(100);
        } else await task.destroy();
      } catch (e) {
        if (active) setError((e as Error).message || "文件预览加载失败");
      }
    };
    void load();
    return () => {
      active = false;
      if (task) void task.destroy();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    base,
    suffix,
    status?.status,
    status?.native,
    status?.contentType,
    reload,
  ]);
  useEffect(() => {
    if (!document || !canvas.current) return;
    let active = true;
    let rendering: { cancel: () => void } | undefined;
    void document
      .getPage(page)
      .then((pdfPage) => {
        if (!active || !canvas.current) return;
        const viewport = pdfPage.getViewport({ scale: zoom }),
          target = canvas.current;
        target.width = viewport.width;
        target.height = viewport.height;
        const context = target.getContext("2d");
        if (!context) throw new Error("浏览器不支持文档画布");
        const render = pdfPage.render({
          canvas: target,
          canvasContext: context,
          viewport,
        });
        rendering = render;
        return render.promise;
      })
      .catch((e) => {
        if (active && (e as Error).name !== "RenderingCancelledException")
          setError("文档页面无法显示，请重试或下载原件");
      });
    return () => {
      active = false;
      rendering?.cancel();
    };
  }, [document, page, zoom]);
  const retry = async () => {
    setBusy(true);
    try {
      await api(`${base}/retry-preview${suffix}`, { method: "POST" });
      setReload((n) => n + 1);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="knowledge-file-preview" ref={container}>
      <Space wrap className="knowledge-preview-toolbar">
        {document && (
          <>
            <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </Button>
            <InputNumber
              aria-label="预览页码"
              min={1}
              max={document.numPages}
              value={page}
              onChange={(v) => v && setPage(v)}
            />
            <span>/ {document.numPages}</span>
            <Button
              disabled={page >= document.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
            <Select
              aria-label="预览缩放"
              value={zoom}
              onChange={setZoom}
              options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({
                value: v,
                label: `${v * 100}%`,
              }))}
            />
          </>
        )}
        <Button
          icon={<FullscreenOutlined />}
          onClick={() => {
            if (container.current?.requestFullscreen)
              void container.current
                .requestFullscreen()
                .catch(() => message.error("浏览器暂不支持全屏"));
            else message.error("浏览器暂不支持全屏");
          }}
        >
          全屏
        </Button>
        <Button
          onClick={() =>
            void downloadApiFile(
              knowledgeFileUrl(file.id, scope),
              file.originalName,
            ).catch((e) => message.error((e as Error).message))
          }
        >
          下载原文件
        </Button>
      </Space>
      {["xls", "xlsx"].includes(
        file.originalName.split(".").pop()?.toLowerCase() ?? "",
      ) && (
        <Alert
          type="info"
          message="Excel预览按工作簿打印区域分页，超宽表格或未设置的打印区域可能显示不完整；完整内容请下载原文件。"
        />
      )}
      {error && (
        <Alert
          type="error"
          message={`在线预览失败：${error}`}
          action={
            <Button onClick={() => setReload((n) => n + 1)}>重新加载</Button>
          }
        />
      )}
      {!status && !error && <Spin tip="读取文件状态" />}
      {status && ["PENDING", "RUNNING"].includes(status.status) && (
        <Alert type="info" showIcon message="文件已上传，在线预览正在生成" />
      )}
      {status?.status === "FAILED" && (
        <Alert
          type="error"
          message={`在线预览生成失败：${status.error ?? "文档转换失败"}`}
          action={
            canRetry ? (
              <Button loading={busy} onClick={() => void retry()}>
                重试转换
              </Button>
            ) : undefined
          }
        />
      )}
      {status?.status === "SUCCEEDED" &&
        !document &&
        !objectUrl &&
        !text &&
        !error && <Progress percent={progress} status="active" />}
      {objectUrl && (
        <img
          src={objectUrl}
          alt={file.originalName}
          onError={() => setError("图片文件无法显示，请下载原件检查文件内容")}
          className="knowledge-preview-image"
        />
      )}
      {text && (
        <>
          <Alert
            type="info"
            message="文本预览最多显示前200KB，完整内容请下载原文件。"
          />
          <pre>{text}</pre>
        </>
      )}
      <div className="knowledge-preview-canvas">
        <canvas
          ref={canvas}
          aria-label="文档在线预览"
          style={{ display: document ? "block" : "none" }}
        />
      </div>
    </div>
  );
}

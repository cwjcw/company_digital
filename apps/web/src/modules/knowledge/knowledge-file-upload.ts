import { api, ApiError } from "../../api";
export type KnowledgeFileUploadInput = { spaceId: string; parentId?: string; title: string; idempotencyKey: string };
/** XHR is limited to upload progress; auth refresh/error semantics still use the existing API. */
export async function uploadKnowledgeFile(
  file: File,
  input: KnowledgeFileUploadInput,
  onProgress: (percent: number) => void,
) {
  await api("/auth/me");
  return new Promise<{ id: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest(),
      form = new FormData();
    form.append("file", file);
    form.append("spaceId", input.spaceId);
    form.append("title", input.title);
    if (input.parentId) form.append("parentId", input.parentId);
    form.append("idempotencyKey", input.idempotencyKey);
    xhr.open("POST", "/api/v1/knowledge/pages/files");
    xhr.timeout = 600000;
    const token = localStorage.getItem("accessToken");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((100 * e.loaded) / e.total));
    };
    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(new ApiError("上传响应异常，请重试", xhr.status));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (typeof body?.id !== "string" || !body.id) reject(new ApiError("上传结果尚未确认，请重试原请求", 0));
        else resolve(body);
      }
      else
        reject(
          new ApiError(
            Array.isArray(body.message)
              ? body.message.join("；")
              : (body.message ?? "文件上传失败"),
            xhr.status,
          ),
        );
    };
    xhr.onerror = () => reject(new ApiError("网络连接失败，请重试", 0));
    xhr.ontimeout = () => reject(new ApiError("上传超时，请重试", 0));
    xhr.send(form);
  });
}

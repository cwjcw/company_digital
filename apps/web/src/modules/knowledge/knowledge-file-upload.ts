import { api, ApiError } from "../../api";
/** XHR is limited to upload progress; auth refresh/error semantics still use the existing API. */
export async function uploadKnowledgeFile(
  file: File,
  input: { spaceId: string; parentId?: string; idempotencyKey: string },
  onProgress: (percent: number) => void,
) {
  await api("/auth/me");
  return new Promise<{ id: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest(),
      form = new FormData();
    form.append("file", file);
    form.append("spaceId", input.spaceId);
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
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
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

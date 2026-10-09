import { beforeEach, describe, it, expect, vi } from "vitest";
import { api } from "../../api";
import { uploadKnowledgeFile } from "./knowledge-file-upload";
vi.mock("../../api", () => ({
  api: vi.fn(),
  ApiError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
class UploadTransport {
  static instances: UploadTransport[] = [];
  upload: { onprogress?: (e: any) => void } = {};
  timeout = 0;
  headers: Record<string, string> = {};
  status = 201;
  responseText = '{"id":"created"}';
  body?: FormData;
  onload?: () => void;
  onerror?: () => void;
  ontimeout?: () => void;
  open = vi.fn();
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: FormData) {
    this.body = body;
    UploadTransport.instances.push(this);
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  UploadTransport.instances = [];
  vi.stubGlobal("XMLHttpRequest", UploadTransport);
  localStorage.clear();
  vi.mocked(api).mockResolvedValue({});
});
describe("runtime authenticated file upload", () => {
  it("refreshes auth then sends original Chinese filename and stable retry key without credentials in URL", async () => {
    localStorage.setItem("accessToken", "fixture-runtime-token");
    const progress = vi.fn();
    const promise = uploadKnowledgeFile(
      new File(["abc"], "制度.docx"),
      { spaceId: "hr", parentId: "policy", idempotencyKey: "stable" },
      progress,
    );
    await vi.waitFor(() => expect(UploadTransport.instances).toHaveLength(1));
    const x = UploadTransport.instances[0]!;
    expect(api).toHaveBeenCalledWith("/auth/me");
    expect(x.open).toHaveBeenCalledWith(
      "POST",
      "/api/v1/knowledge/pages/files",
    );
    expect(x.headers.Authorization).toBe("Bearer fixture-runtime-token");
    expect(x.body?.get("idempotencyKey")).toBe("stable");
    expect((x.body?.get("file") as File).name).toBe("制度.docx");
    x.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    expect(progress).toHaveBeenCalledWith(50);
    x.onload?.();
    await expect(promise).resolves.toEqual({ id: "created" });
  });
  it.each(["network", "timeout", "invalid response", "forbidden"])(
    "reports %s failure so a single batch entry can retry",
    async (kind) => {
      const promise = uploadKnowledgeFile(
        new File(["x"], "x.pdf"),
        { spaceId: "hr", idempotencyKey: "same-key" },
        () => {},
      );
      await vi.waitFor(() => expect(UploadTransport.instances).toHaveLength(1));
      const x = UploadTransport.instances[0]!;
      if (kind === "network") x.onerror?.();
      else if (kind === "timeout") x.ontimeout?.();
      else {
        x.status = kind === "forbidden" ? 403 : 500;
        x.responseText =
          kind === "forbidden" ? '{"message":"无权限"}' : "invalid";
        x.onload?.();
      }
      await expect(promise).rejects.toThrow();
    },
  );
  it("does not start a request if authentication refresh fails", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("登录已失效"));
    await expect(
      uploadKnowledgeFile(
        new File(["x"], "x.pdf"),
        { spaceId: "hr", idempotencyKey: "key" },
        () => {},
      ),
    ).rejects.toThrow("登录已失效");
    expect(UploadTransport.instances).toHaveLength(0);
  });
});

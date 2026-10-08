export type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";
/** One serialized version stream for autosave, uploads and explicit commands. */
export class KnowledgeDraftSession {
  version: number;
  state: SaveState = "saved";
  error = "";
  private local: Record<string, unknown> = {};
  private operations = 0;
  private pending: Record<string, unknown> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  constructor(
    version: number,
    private readonly save: (
      payload: Record<string, unknown>,
    ) => Promise<{ version: number }>,
    private readonly delay = 1200,
  ) {
    this.version = version;
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }
  changed(patch: Record<string, unknown>) {
    Object.assign(this.pending, patch);
    Object.assign(this.local, patch);
    if (this.state !== "conflict") this.state = "dirty";
    clearTimeout(this.timer);
    if (this.state !== "conflict")
      this.timer = setTimeout(() => {
        void this.flush().catch(() => undefined);
      }, this.delay);
    this.emit();
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
  flush() {
    clearTimeout(this.timer);
    return this.serial(() => this.drain());
  }
  private async drain() {
    if (this.state === "conflict") throw new Error(this.error);
    while (Object.keys(this.pending).length) {
      const patch = this.pending;
      this.pending = {};
      this.state = "saving";
      this.error = "";
      this.emit();
      try {
        const result = await this.save({
          ...patch,
          expectedVersion: this.version,
        });
        this.version = result.version;
      } catch (e) {
        this.pending = { ...patch, ...this.pending };
        this.state =
          (e as { status?: number }).status === 409 ? "conflict" : "failed";
        this.error = (e as Error).message;
        this.emit();
        throw e;
      }
    }
    this.state = "saved";
    this.error = "";
    this.emit();
  }
  run<T extends { version: number }>(
    operation: (version: number) => Promise<T>,
  ): Promise<T> {
    clearTimeout(this.timer);
    this.operations++;
    this.emit();
    return this.serial(async () => {
      await this.drain();
      try {
        const result = await operation(this.version);
        this.version = result.version;
        this.emit();
        return result;
      } catch (e) {
        if ((e as { status?: number }).status === 409) {
          this.state = "conflict";
          this.error = (e as Error).message;
          this.emit();
        }
        throw e;
      }
    }).finally(() => {
      this.operations--;
      this.emit();
    });
  }
  isOperating() {
    return this.operations > 0;
  }
  recovery() {
    return { ...this.local };
  }
  compareServerVersion(version: number) {
    if (
      this.hasUnsaved() &&
      this.state !== "saving" &&
      !this.isOperating() &&
      version !== this.version
    ) {
      this.state = "conflict";
      this.error =
        "服务器版本已更新，本地修改已保留，请复制需要保留的内容后重新加载";
    }
  }
  hasUnsaved() {
    return (
      Object.keys(this.pending).length > 0 ||
      this.operations > 0 ||
      this.state === "saving" ||
      this.state === "conflict"
    );
  }
  stop() {
    clearTimeout(this.timer);
  }
}

// Failed drafts stay only in memory, scoped to the current platform identity/permissions.
let owner = "";
const drafts = new Map<string, KnowledgeDraftSession>();
function currentOwner() {
  try {
    const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
    return user.sub
      ? JSON.stringify([
          user.sub,
          user.permissions,
          user.moduleAdminCodes,
          user.tableDataScopes,
        ])
      : "";
  } catch {
    return "";
  }
}
export function clearKnowledgeDraftCache() {
  drafts.clear();
  owner = "";
}
export function recoverKnowledgeDraft(id: string) {
  const active = currentOwner();
  if (active !== owner) {
    drafts.clear();
    owner = active;
  }
  return drafts.get(id);
}
export function rememberKnowledgeDraft(
  id: string,
  session: KnowledgeDraftSession,
) {
  if (currentOwner() !== owner) return;
  if (session.hasUnsaved()) drafts.set(id, session);
  else drafts.delete(id);
}
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", (event) => {
    if (currentOwner() !== owner) {
      clearKnowledgeDraftCache();
      return;
    }
    if ([...drafts.values()].some((s) => s.hasUnsaved())) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

export async function flushKnowledgeDrafts() {
  const active = currentOwner();
  if (active !== owner) {
    clearKnowledgeDraftCache();
    return;
  }
  for (const draft of drafts.values()) {
    if (draft.isOperating())
      throw new Error("文件操作正在进行，请完成后再退出");
    await draft.flush();
  }
}

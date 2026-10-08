import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KnowledgeDraftSession,
  clearKnowledgeDraftCache,
  recoverKnowledgeDraft,
  rememberKnowledgeDraft,
} from "./knowledge-autosave";
afterEach(() => {
  vi.useRealTimers();
  clearKnowledgeDraftCache();
  localStorage.clear();
});
describe("Knowledge autosave version queue", () => {
  it("debounces edits and saves only the newest pending value", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ version: 2 });
    const s = new KnowledgeDraftSession(1, save);
    s.changed({ title: "甲" });
    s.changed({ title: "乙" });
    await vi.advanceTimersByTimeAsync(1199);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith({ title: "乙", expectedVersion: 1 });
    expect(s.state).toBe("saved");
    expect(s.version).toBe(2);
  });
  it("serializes upload/publish after pending save, using the returned version", async () => {
    const save = vi.fn().mockResolvedValue({ version: 8 }),
      upload = vi.fn().mockResolvedValue({ version: 9 }),
      publish = vi.fn().mockResolvedValue({ version: 10 });
    const s = new KnowledgeDraftSession(7, save);
    s.changed({ title: "新标题" });
    await s.run(upload);
    await s.run(publish);
    expect(upload).toHaveBeenCalledWith(8);
    expect(publish).toHaveBeenCalledWith(9);
    expect(s.version).toBe(10);
  });
  it("drains edits arriving during an in-flight save without losing them", async () => {
    let release!: (v: { version: number }) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            release = r;
          }),
      )
      .mockResolvedValue({ version: 3 });
    const s = new KnowledgeDraftSession(1, save);
    s.changed({ title: "第一" });
    const done = s.flush();
    await Promise.resolve();
    s.changed({ title: "第二" });
    release({ version: 2 });
    await done;
    expect(save).toHaveBeenLastCalledWith({
      title: "第二",
      expectedVersion: 2,
    });
    expect(s.version).toBe(3);
    expect(s.hasUnsaved()).toBe(false);
    s.stop();
  });
  it("keeps failed changes for retry and never advances the version on failure", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("网络失败"))
      .mockResolvedValue({ version: 2 });
    const s = new KnowledgeDraftSession(1, save);
    s.changed({ title: "本地修改" });
    await expect(s.flush()).rejects.toThrow("网络失败");
    expect(s.state).toBe("failed");
    expect(s.version).toBe(1);
    expect(s.hasUnsaved()).toBe(true);
    await s.flush();
    expect(save).toHaveBeenLastCalledWith({
      title: "本地修改",
      expectedVersion: 1,
    });
    expect(s.state).toBe("saved");
  });
  it("freezes 409 conflicts without retrying or silently overwriting", async () => {
    const save = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("冲突"), { status: 409 }));
    const s = new KnowledgeDraftSession(4, save);
    s.changed({ title: "冲突文本" });
    await expect(s.flush()).rejects.toThrow("冲突");
    s.changed({ title: "保留文本" });
    await expect(s.flush()).rejects.toThrow("冲突");
    const publish = vi.fn();
    await expect(s.run(publish)).rejects.toThrow("冲突");
    expect(save).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(s.version).toBe(4);
    expect(s.state).toBe("conflict");
  });
  it("failed explicit publication preserves the last successful saved version", async () => {
    const s = new KnowledgeDraftSession(
      1,
      vi.fn().mockResolvedValue({ version: 2 }),
    );
    s.changed({ title: "新标题" });
    await expect(
      s.run(() => Promise.reject(new Error("父页未发布"))),
    ).rejects.toThrow("父页未发布");
    expect(s.version).toBe(2);
    const retry = vi.fn().mockResolvedValue({ version: 3 });
    await s.run(retry);
    expect(retry).toHaveBeenCalledWith(2);
  });
  it("retains unsaved local content across component navigation, not across identities", async () => {
    localStorage.setItem(
      "sessionUser",
      JSON.stringify({ sub: "a", permissions: ["read"] }),
    );
    recoverKnowledgeDraft("p");
    const s = new KnowledgeDraftSession(
      1,
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    s.changed({ title: "保留正文" });
    await expect(s.flush()).rejects.toThrow("offline");
    rememberKnowledgeDraft("p", s);
    expect(recoverKnowledgeDraft("p")?.recovery()).toEqual({
      title: "保留正文",
    });
    localStorage.setItem(
      "sessionUser",
      JSON.stringify({ sub: "b", permissions: ["read"] }),
    );
    expect(recoverKnowledgeDraft("p")).toBeUndefined();
  });
  it("recovered edits cannot silently overwrite a newer server revision", () => {
    const s = new KnowledgeDraftSession(2, vi.fn());
    s.changed({ title: "本地修改" });
    s.compareServerVersion(3);
    expect(s.state).toBe("conflict");
    expect(s.recovery()).toEqual({ title: "本地修改" });
    s.stop();
  });
  it("tracks in-flight file operations for unload protection", async () => {
    let release!: (r: { version: number }) => void;
    const s = new KnowledgeDraftSession(1, vi.fn());
    const result = s.run(
      () =>
        new Promise<{ version: number }>((r) => {
          release = r;
        }),
    );
    expect(s.isOperating()).toBe(true);
    expect(s.hasUnsaved()).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    release({ version: 2 });
    await result;
    expect(s.isOperating()).toBe(false);
    expect(s.hasUnsaved()).toBe(false);
  });
});

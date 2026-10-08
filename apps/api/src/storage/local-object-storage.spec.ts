import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalObjectStorage } from "./local-object-storage";

describe("LocalObjectStorage private delivery", () => {
  let directory: string;
  let original: string | undefined;
  let storage: LocalObjectStorage;
  beforeEach(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "kdos-private-storage-"),
    );
    original = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = directory;
    storage = new LocalObjectStorage();
  });
  afterEach(async () => {
    if (original == null) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = original;
    await fs.rm(directory, { recursive: true, force: true });
  });
  it("keeps existing public delivery and private objects separate without a public URL", async () => {
    const publicFile = await storage.put({
      key: "planning/a",
      body: Buffer.from("public"),
      contentType: "text/plain",
    });
    const privateFile = await storage.put({
      key: "knowledge/a/b",
      body: Buffer.from("private"),
      contentType: "text/plain",
      visibility: "private",
    });
    expect(publicFile).toEqual({
      key: "planning/a",
      url: "/uploads/planning/a",
    });
    expect(privateFile).toEqual({ key: ".private/knowledge/a/b", url: "" });
    expect(await storage.get("knowledge/a/b")).toBeNull();
    expect((await storage.get(privateFile.key))?.body.toString()).toBe(
      "private",
    );
    expect(
      (await fs.stat(path.join(directory, privateFile.key))).mode & 0o777,
    ).toBe(0o640);
    await storage.delete(privateFile.key);
    expect(await storage.get(privateFile.key)).toBeNull();
  });
  it.each([
    "../secret",
    ".private/../../secret",
    "/etc/passwd",
    ".private/%2e%2e/secret",
    "a/../secret",
  ])("rejects traversal %s", async (key) => {
    await expect(storage.get(key)).rejects.toThrow("Invalid object key");
  });
  it("enumerates only the requested private prefix and skips symbolic links", async () => {
    await storage.put({
      key: "knowledge/tenant/page/file",
      body: Buffer.from("private"),
      contentType: "text/plain",
      visibility: "private",
    });
    await storage.put({
      key: "knowledge/other/page/file",
      body: Buffer.from("other"),
      contentType: "text/plain",
      visibility: "private",
    });
    await storage.put({
      key: "knowledge/tenant/public",
      body: Buffer.from("public"),
      contentType: "text/plain",
    });
    await fs.symlink(
      path.join(directory, ".private/knowledge/other"),
      path.join(directory, ".private/knowledge/tenant/escape"),
    );
    const keys: string[] = [];
    for await (const key of storage.listPrivateKeys("knowledge/tenant"))
      keys.push(key);
    expect(keys).toEqual([".private/knowledge/tenant/page/file"]);
    await expect(async () => {
      for await (const _key of storage.listPrivateKeys("../escape")) {
        void _key;
      }
    }).rejects.toThrow("Invalid object key");
  });
});

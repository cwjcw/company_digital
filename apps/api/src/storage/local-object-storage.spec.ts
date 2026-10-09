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

describe("ObjectStorage streaming and bounded ranges",()=>{
  it("streams a large private object with an exact inclusive range",async()=>{
    const { Readable }=await import("node:stream");
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),"kdos-stream-"));const previous=process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR=directory;
    try{const storage=new LocalObjectStorage();const count=25,size=1024*1024;
      const source=Readable.from((async function*(){for(let i=0;i<count;i++)yield Buffer.alloc(size,i);})());
      const object=await storage.put({key:'knowledge/stream/large',body:source,contentType:'application/pdf',visibility:'private'});
      expect(await storage.stat(object.key)).toEqual({size:count*size});
      const stream=await storage.openStream(object.key,{start:size-2,end:size+2});const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(Buffer.from([0,0,1,1,1]));
      await expect(storage.openStream(object.key,{start:0,end:count*size})).rejects.toThrow('Invalid object range');
      expect(await storage.stat('.private/knowledge/missing')).toBeNull();
    }finally{if(previous===undefined)delete process.env.UPLOAD_DIR;else process.env.UPLOAD_DIR=previous;await fs.rm(directory,{recursive:true,force:true});}
  });
});

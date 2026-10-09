import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Injectable } from "@nestjs/common";
import type {
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "./object-storage";

@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly directory = path.resolve(
    process.cwd(),
    process.env.UPLOAD_DIR ?? "./data/uploads",
  );
  private safePath(key: string) {
    if (
      !/^(?:\.private\/)?[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) ||
      key.includes("..")
    )
      throw new Error("Invalid object key");
    const resolved = path.resolve(this.directory, key);
    if (!resolved.startsWith(`${this.directory}${path.sep}`))
      throw new Error("Invalid object key");
    return resolved;
  }
  async put(input: PutObjectInput) {
    const key =
      input.visibility === "private" ? `.private/${input.key}` : input.key;
    const target = this.safePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await pipeline(Buffer.isBuffer(input.body) ? Readable.from(input.body) : input.body,
        createWriteStream(temporary, { flags: "wx", mode: 0o640 }));
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
    return { key, url: key.startsWith(".private/") ? "" : `/uploads/${key}` };
  }
  async get(key: string): Promise<StoredObject | null> {
    try {
      return {
        key,
        contentType: "application/octet-stream",
        body: await fs.readFile(this.safePath(key)),
      };
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  async stat(key: string) {
    try {
      const info = await fs.stat(this.safePath(key));
      if (!info.isFile()) throw new Error("Object is not a file");
      return { size: info.size };
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }
  async openStream(key: string, range?: { start: number; end: number }) {
    const info = await this.stat(key);
    if (!info) return null;
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) ||
      range.start < 0 || range.end < range.start || range.end >= info.size))
      throw new Error("Invalid object range");
    return createReadStream(this.safePath(key), range);
  }
  async delete(key: string) {
    try {
      await fs.unlink(this.safePath(key));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  async *listPrivateKeys(prefix: string): AsyncGenerator<string> {
    const base = this.safePath(`.private/${prefix}`);
    const walk = async function* (directory: string): AsyncGenerator<string> {
      let handle;
      try {
        handle = await fs.opendir(directory);
      } catch (error: any) {
        if (error?.code === "ENOENT") return;
        throw error;
      }
      for await (const entry of handle) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) yield* walk(target);
        else if (entry.isFile()) yield target;
      }
    };
    for await (const target of walk(base))
      yield path.relative(this.directory, target).split(path.sep).join("/");
  }
}

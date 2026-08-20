import fs from "node:fs/promises";
import path from "node:path";
import { Injectable } from "@nestjs/common";
import type { ObjectStorage, PutObjectInput, StoredObject } from "./object-storage";

@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly directory = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./data/uploads");
  private safePath(key: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) || key.includes("..")) throw new Error("Invalid object key");
    const resolved = path.resolve(this.directory, key);
    if (!resolved.startsWith(`${this.directory}${path.sep}`)) throw new Error("Invalid object key");
    return resolved;
  }
  async put(input: PutObjectInput) {
    const target = this.safePath(input.key); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, input.body, { mode: 0o640 });
    return { key: input.key, url: `/uploads/${input.key}` };
  }
  async get(key: string): Promise<StoredObject | null> {
    try { return { key, contentType: "application/octet-stream", body: await fs.readFile(this.safePath(key)) }; }
    catch (error: any) { if (error?.code === "ENOENT") return null; throw error; }
  }
  async delete(key: string) { try { await fs.unlink(this.safePath(key)); } catch (error: any) { if (error?.code !== "ENOENT") throw error; } }
}

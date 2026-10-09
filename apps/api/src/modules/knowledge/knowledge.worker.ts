/** Dedicated process entry; never bootstrap the API or its unrelated scheduled jobs. */
import "reflect-metadata";
import fs from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { DataSource } from "typeorm";
import { LocalObjectStorage } from "../../storage/local-object-storage";
import { KnowledgePreviewJobs } from "./knowledge.preview.service";

export async function convertKnowledgeDocument(
  source: string,
  output: string,
  profile: string,
  timeoutMs: number,
  executable = process.env.KNOWLEDGE_LIBREOFFICE ?? "libreoffice",
) {
  await fs.mkdir(path.join(profile, "user"), { recursive: true, mode: 0o700 });
  // Very high macro security; no remote link or document update prompts/fetching.
  await fs.writeFile(
    path.join(profile, "user", "registrymodifications.xcu"),
    `<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>`,
  );
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        `-env:UserInstallation=file://${profile}`,
        "--headless",
        "--norestore",
        "--nodefault",
        "--nolockcheck",
        "--nofirststartwizard",
        "--convert-to",
        "pdf",
        "--outdir",
        output,
        source,
      ],
      {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        env: {
          PATH: process.env.PATH,
          HOME: profile,
          TMPDIR: output,
          LANG: "C.UTF-8",
        },
      },
    );
    const kill = () => {
      if (child.pid)
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Process already gone. */
        }
    };
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      kill();
      reject(new Error("文档转换进程无法启动"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      kill();
      if (timedOut) reject(new Error("文档转换超时"));
      else if (code !== 0) reject(new Error("文档转换进程异常退出"));
      else resolve();
    });
  });
}
export async function processKnowledgePreview(
  job: any,
  tenant: string,
  jobs: KnowledgePreviewJobs,
  storage: LocalObjectStorage,
  timeoutMs: number,
) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "kdos-document-"));
  try {
    const extension = path.extname(job.original_name).toLowerCase();
    if (
      ![".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(extension)
    )
      throw new Error("不支持的文档转换类型");
    const input = path.join(scratch, "original" + extension),
      stream = await storage.openStream(job.original_key);
    if (!stream) throw new Error("原文件不存在");
    const digest = createHash("sha256");
    stream.on("data", (chunk) => digest.update(chunk));
    await pipeline(stream, createWriteStream(input, { mode: 0o600 }));
    if (digest.digest("hex") !== job.sha256) throw new Error("原文件校验失败");
    await convertKnowledgeDocument(
      input,
      scratch,
      path.join(scratch, "profile"),
      timeoutMs,
    );
    const pdf = path.join(scratch, "original.pdf"),
      stat = await fs.stat(pdf).catch(() => null);
    if (!stat || !stat.size || stat.size > 100 * 1024 * 1024)
      throw new Error("未生成有效PDF或预览超过100MB");
    const h = await fs.open(pdf, "r");
    try {
      const header = Buffer.alloc(5);
      await h.read(header, 0, 5, 0);
      if (header.toString() !== "%PDF-") throw new Error("转换未生成PDF");
    } finally {
      await h.close();
    }
    await storage.put({
      key: job.key.replace(/^\.private\//, ""),
      visibility: "private",
      body: createReadStream(pdf),
      contentType: "application/pdf",
    });
    const saved = await jobs.complete(tenant, job.id, job.leaseId, {
      size: stat.size,
    });
    if (!saved) await storage.delete(job.key);
  } catch (error) {
    await storage.delete(job.key).catch(() => undefined);
    await jobs.complete(tenant, job.id, job.leaseId, {
      error: error instanceof Error ? error.message : "文档转换失败",
    });
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}
async function main() {
  const tenant = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
    timeoutSeconds = Number(
      process.env.KNOWLEDGE_CONVERSION_TIMEOUT_SECONDS ?? 120,
    );
  if (
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 10 ||
    timeoutSeconds > 600
  )
    throw new Error("Invalid conversion timeout");
  const source = new DataSource({
    type: "postgres",
    host: process.env.DATABASE_HOST ?? "postgres",
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    synchronize: false,
    logging: false,
    extra: { max: 2 },
  });
  await source.initialize();
  const jobs = new KnowledgePreviewJobs(source),
    storage = new LocalObjectStorage();
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  while (!stopping) {
    try {
      const job = await jobs.claim(tenant, timeoutSeconds + 90);
      // Readiness requires a successful database claim/poll, not just a live loop.
      await fs.writeFile("/tmp/knowledge-worker-health", String(Date.now()));
      if (job)
        await processKnowledgePreview(
          job,
          tenant,
          jobs,
          storage,
          timeoutSeconds * 1000,
        );
      else await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch {
      console.error(
        "Knowledge worker unavailable; retrying without affecting API.",
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  await source.destroy();
}
if (require.main === module)
  void main().catch(() => {
    console.error("Knowledge document worker failed to initialize.");
    process.exitCode = 1;
  });

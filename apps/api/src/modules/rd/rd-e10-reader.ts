import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

export type E10ItemRow = {
  source_id: string; item_code: string; item_name: string; specification: string; remark: string; is_group_item: boolean | null;
  status: string | null; approve_status: string | null; created_at_source: string | null; last_modified_at_source: string | null;
  modified_at_source: string | null; created_by_source: string | null; last_modified_by_source: string | null; modified_by_source: string | null;
  created_by_name: string | null; last_modified_by_name: string | null; modified_by_name: string | null;
};

@Injectable()
export class RdE10Reader {
  async *read(mode: "FULL" | "INCREMENTAL", since?: { at: string | null; id: string | null }): AsyncGenerator<E10ItemRow> {
    const script = process.env.RD_E10_READER ?? path.resolve(process.cwd(), "../../data-operations/e10/rd_reader.py");
    const python = process.env.RD_E10_PYTHON ?? "/data/automation/code/work/basci/basic_code/.venv/bin/python";
    const args = [script, "--mode", mode, "--batch-size", "1000"];
    if (mode === "INCREMENTAL" && since?.at) args.push("--since-at", since.at, "--since-id", since.id ?? "");
    const basicCodeRoot = process.env.RD_BASIC_CODE_ROOT ?? "/data/automation/code/work/basci/basic_code";
    const child = spawn(python, args, { env: { ...process.env, PYTHONPATH: basicCodeRoot } });
    const exitPromise = new Promise<number | null>((resolve) => child.once("close", resolve));
    let error = "";
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString(); });
    const lines = createInterface({ input: child.stdout as Readable, crlfDelay: Infinity });
    for await (const line of lines) if (line.trim()) yield JSON.parse(line) as E10ItemRow;
    const exitCode = await exitPromise;
    if (exitCode !== 0) throw new Error(`E10 只读读取失败：${error.trim().slice(-500) || `exit=${exitCode}`}`);
  }
}

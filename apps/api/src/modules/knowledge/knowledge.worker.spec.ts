import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { convertKnowledgeDocument } from "./knowledge.worker";
describe("Document subprocess isolation", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "kdos-conversion-test-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  it("terminates the whole process group on a deadline", async () => {
    const executable = path.join(dir, "sleep");
    await fs.writeFile(executable, "#!/bin/sh\nsleep 30\n", { mode: 0o700 });
    const started = Date.now();
    await expect(
      convertKnowledgeDocument(
        "input",
        dir,
        path.join(dir, "profile"),
        150,
        executable,
      ),
    ).rejects.toThrow("超时");
    expect(Date.now() - started).toBeLessThan(3000);
  });
  it("reports a crashed converter without exposing its output", async () => {
    const executable = path.join(dir, "crash");
    await fs.writeFile(
      executable,
      "#!/bin/sh\necho confidential >&2\nexit 2\n",
      { mode: 0o700 },
    );
    await expect(
      convertKnowledgeDocument(
        "input",
        dir,
        path.join(dir, "profile"),
        1000,
        executable,
      ),
    ).rejects.toThrow("异常退出");
  });
  it("reports an unavailable executable", async () => {
    await expect(
      convertKnowledgeDocument(
        "input",
        dir,
        path.join(dir, "profile"),
        1000,
        path.join(dir, "missing"),
      ),
    ).rejects.toThrow("无法启动");
  });
});

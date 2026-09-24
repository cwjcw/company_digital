import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const buildId = `${Date.now()}`;
const rawBuildCommit = process.env.VITE_KDOS_BUILD_SHA?.trim().toLowerCase() ?? "";
const buildCommit = /^[0-9a-f]{40}$/.test(rawBuildCommit) ? rawBuildCommit : "unknown";
const shortCommit = buildCommit === "unknown" ? "unknown" : buildCommit.slice(0, 7);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId), __KDOS_BUILD_SHA__: JSON.stringify(buildCommit) },
  plugins: [react(), {
    name: "kdos-build-version",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ buildId, commit: buildCommit, shortCommit }) });
      this.emitFile({ type: "asset", fileName: "build-info.json", source: JSON.stringify({ commit: buildCommit, shortCommit }) });
    }
  }],
  server: {
    port: 5173,
    allowedHosts: ["knplan.cuixiaoyuan.cn"],
    proxy: {
      "/api": "http://localhost:15173",
      "/uploads": "http://localhost:15173",
      "/socket.io": { target: "http://localhost:15173", ws: true },
      "/plans": { target: "ws://localhost:15173", ws: true }
    }
  },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts", exclude: ["e2e/**", "node_modules/**", "dist/**"] }
});

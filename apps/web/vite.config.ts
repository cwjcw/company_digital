import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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

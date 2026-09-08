import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "antd/dist/reset.css";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "./styles.css";
import App from "./App";
import { queryClient } from "./query-client";

declare const __BUILD_ID__: string;

dayjs.locale("zh-cn");

if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

if (import.meta.env.PROD) {
  const checkForNewBuild = async () => {
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const version = await response.json() as { buildId?: string };
      if (version.buildId && version.buildId !== __BUILD_ID__) window.location.reload();
    } catch {
      // A temporary network failure must not interrupt the current session.
    }
  };
  window.addEventListener("focus", () => void checkForNewBuild());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkForNewBuild(); });
  window.setInterval(() => void checkForNewBuild(), 60_000);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: "#176B87", borderRadius: 8, fontFamily: "'Microsoft YaHei UI', sans-serif" } }}>
      <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
    </ConfigProvider>
  </React.StrictMode>
);

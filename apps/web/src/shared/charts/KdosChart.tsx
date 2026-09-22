import { Empty, Spin, theme } from "antd";
import * as echarts from "echarts";
import type { ECharts, EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";
import { applyKdosChartTheme } from "./chart-theme";

export type KdosChartProps = {
  option: EChartsOption;
  loading?: boolean;
  empty?: boolean;
  emptyText?: string;
  height?: number | string;
  className?: string;
  ariaLabel: string;
};

/**
 * KDOS 统一业务图表容器：唯一负责 ECharts 生命周期、主题基础样式和容器尺寸变化。
 * 业务页面不得直接调用 echarts.init()。
 */
export function KdosChart({ option, loading = false, empty = false, emptyText = "暂无数据", height = 300, className, ariaLabel }: KdosChartProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const { token } = theme.useToken();
  const themedOption = useMemo(() => applyKdosChartTheme(option, token), [option, token]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || empty) return;
    const instance = echarts.init(element, undefined, { renderer: "canvas" });
    instanceRef.current = instance;
    const resize = () => instance.resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(element);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      instance.dispose();
      if (instanceRef.current === instance) instanceRef.current = null;
    };
  }, [empty]);

  useEffect(() => {
    if (!empty && instanceRef.current) instanceRef.current.setOption(themedOption, { notMerge: true, lazyUpdate: true });
  }, [empty, themedOption]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    if (loading) instance.showLoading("default", { text: "加载中" });
    else instance.hideLoading();
  }, [loading, empty]);

  return <div className={["kdos-chart", className].filter(Boolean).join(" ")} style={{ height }} role="img" aria-label={ariaLabel}>
    <div className="kdos-chart-canvas" ref={elementRef} />
    {empty && <div className="kdos-chart-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} /></div>}
    {loading && <div className="kdos-chart-loading"><Spin /></div>}
  </div>;
}

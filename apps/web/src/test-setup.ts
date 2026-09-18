import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

/* KN-TEST-001：全量 Vitest 并行运行时 CPU 竞争会让默认 1s 的 waitFor/findBy 超时偶发失败
   （断言本身正确，只是异步尚未 settle）。放宽 Testing Library 的异步工具超时到 5s：
   真实错误的断言仍会失败，只是不再因为机器瞬时负载而随机报红。 */
configure({ asyncUtilTimeout: 5_000 });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    dispatchEvent: () => false
  })
});

const browserGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = (element: Element) => browserGetComputedStyle(element);

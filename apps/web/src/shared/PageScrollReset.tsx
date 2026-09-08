import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/** Each page opens at its start, including browser back/forward and reload. */
export function PageScrollReset() {
  const { pathname, key } = useLocation();
  useLayoutEffect(() => {
    const reset = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.querySelectorAll<HTMLElement>(".content").forEach((element) => {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      });
    };
    reset();
    const frame = requestAnimationFrame(reset);
    window.addEventListener("pageshow", reset);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pageshow", reset); };
  }, [pathname, key]);
  return null;
}

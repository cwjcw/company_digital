import { describe, expect, it } from "vitest";
import { mpsDashboardNavigationUrl, readMpsDashboardNavigation, type MpsDashboardFilters } from "./index";
describe("cockpit cross-dashboard scope whitelist", () => {
  it("roundtrips the complete shared filter contract and selected formal gap", () => {
    const filters: MpsDashboardFilters = { divisionId: "0199aa00-0000-7000-8000-000000000001", customerCode: "C&1", orderNumbers: ["SO-1", "SO-2"], itemCodes: ["ITEM"], dateType: "DELIVERY", datePeriod: "CUSTOM", dateFrom: "2026-10-01", dateTo: "2026-10-16" };
    for (const path of ["/master-plan-gaps", "/master-plan-order-progress", "/master-plan-reports"] as const) {
      const url = new URL(mpsDashboardNavigationUrl(path, filters, "overdue"), "http://fixture");
      expect(url.pathname).toBe(path); expect(readMpsDashboardNavigation(url.search)).toEqual({ filters, gap: "overdue" });
    }
  });
  it("keeps direct-open defaults distinct from carried no-date scope", () => {
    expect(readMpsDashboardNavigation("?dateType=NONE&orderNumbers=[]")).toBeNull();
    expect(readMpsDashboardNavigation(new URL(mpsDashboardNavigationUrl("/master-plan-order-progress", {}), "http://fixture").search)).toEqual({ filters: { dateType: "NONE" } });
    expect(readMpsDashboardNavigation("?from=other&dateType=ORDER")).toBeNull();
  });
  it("rejects malformed declared conditions instead of broadening to unfiltered results", () => {
    for (const query of ["divisionId=事业部", "orderNumbers=broken", "orderNumbers={}", 'itemCodes=[42]', 'itemCodes=[""]', "dateType=wrong", "dateType=ORDER&datePeriod=DAY&dateValue=2026-02-30", "dateType=DELIVERY&datePeriod=CUSTOM&dateFrom=2026-10-16&dateTo=2026-10-01", "datePeriod=wrong", "gap=missing-three-day-work-order", "customerCode=A&customerCode=B", `orderNumbers=${encodeURIComponent(JSON.stringify(Array.from({ length: 101 }, (_, i) => String(i))))}`]) expect(() => readMpsDashboardNavigation("?from=pmc-cockpit&" + query)).toThrow();
  });
  it("never forwards identity, permission, SQL or redirect fields", () => {
    const parsed = readMpsDashboardNavigation('?from=pmc-cockpit&tenantId=foreign&userId=admin&permissions=*&sql=delete&returnTo=https://evil&orderNumbers=["SO-1"]');
    expect(parsed).toEqual({ filters: { dateType: "NONE", orderNumbers: ["SO-1"] } });
    expect(() => mpsDashboardNavigationUrl("https://evil" as never, {})).toThrow("目标页面无效");
  });
});

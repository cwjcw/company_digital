import { describe, expect, it } from "vitest";
import { BUSINESS_QUERY_GC_TIME_MS, BUSINESS_QUERY_STALE_TIME_MS, createKdosQueryClient } from "./query-client";

describe("KDOS query cache defaults", () => {
  it("keeps table data fresh across ordinary page re-entry", () => {
    const options = createKdosQueryClient().getDefaultOptions().queries;
    expect(options?.staleTime).toBe(BUSINESS_QUERY_STALE_TIME_MS);
    expect(options?.gcTime).toBe(BUSINESS_QUERY_GC_TIME_MS);
    expect(options?.refetchOnWindowFocus).toBe(false);
    expect(BUSINESS_QUERY_STALE_TIME_MS).toBeGreaterThanOrEqual(60_000);
  });
});

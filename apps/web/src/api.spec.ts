import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api response parsing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns null for an empty successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await expect(api<null>("/planning/periods/by-month?year=2026&month=8")).resolves.toBeNull();
  });

  it("parses a JSON response without changing its shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "period-1" }));

    await expect(api<{ id: string }>("/planning/periods/by-month?year=2026&month=9"))
      .resolves.toEqual({ id: "period-1" });
  });
});

import { describe, expect, it } from "vitest";
import { KeycloakProvider, LocalDevelopmentAuthProvider } from "./index";

describe("Auth providers", () => {
  it("normalizes external identities without using provider subject as business id", async () => {
    const provider = new KeycloakProvider({ issuer: "https://identity.example/realms/kdos", clientId: "kdos-web" }, async () => ({ sub: "kc-123", preferred_username: "planner", name: "计划员" }));
    await expect(provider.verifyAccessToken("token")).resolves.toMatchObject({ provider: "keycloak", subject: "kc-123", username: "planner" });
  });
  it("supports the phase-one local provider boundary", async () => {
    const provider = new LocalDevelopmentAuthProvider(async () => ({ sub: "business-user-id", username: "admin" }));
    await expect(provider.verifyAccessToken("token")).resolves.toMatchObject({ provider: "local-development", username: "admin" });
  });
});

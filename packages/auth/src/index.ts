export interface AuthIdentity { provider: string; subject: string; username: string; displayName?: string; claims: Record<string, unknown>; }
export interface AuthProvider { readonly id: string; verifyAccessToken(token: string): Promise<AuthIdentity>; }
export interface KeycloakProviderOptions { issuer: string; clientId: string; audience?: string; }
export class KeycloakAuthProviderConfig {
  readonly id = "keycloak";
  constructor(readonly options: KeycloakProviderOptions) {}
}
export class LocalDevelopmentAuthProviderConfig { readonly id = "local-development"; }

export type AccessTokenVerifier = (token: string) => Promise<Record<string, unknown>>;

export class KeycloakProvider implements AuthProvider {
  readonly id = "keycloak";
  constructor(readonly options: KeycloakProviderOptions, private readonly verifier: AccessTokenVerifier) {}
  async verifyAccessToken(token: string): Promise<AuthIdentity> {
    const claims = await this.verifier(token); const subject = String(claims.sub ?? ""); const username = String(claims.preferred_username ?? claims.email ?? "");
    if (!subject || !username) throw new Error("Keycloak token 缺少 sub 或 preferred_username");
    return { provider: this.id, subject, username, displayName: claims.name ? String(claims.name) : undefined, claims };
  }
}

export class LocalDevelopmentAuthProvider implements AuthProvider {
  readonly id = "local-development";
  constructor(private readonly verifier: AccessTokenVerifier) {}
  async verifyAccessToken(token: string): Promise<AuthIdentity> {
    const claims = await this.verifier(token); const subject = String(claims.sub ?? ""); const username = String(claims.username ?? "");
    if (!subject || !username) throw new Error("Local token 缺少 sub 或 username");
    return { provider: this.id, subject, username, displayName: claims.displayName ? String(claims.displayName) : undefined, claims };
  }
}

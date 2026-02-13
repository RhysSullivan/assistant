import type {
  AnonOAuthClientRegistration,
  AuthorizationCode,
  OAuthStorage,
  StoredSigningKey,
} from "./anonymous-oauth-types";

export class InMemoryOAuthStorage implements OAuthStorage {
  private signingKey: StoredSigningKey | null = null;
  private readonly clients = new Map<string, AnonOAuthClientRegistration>();
  private readonly authorizationCodes = new Map<string, AuthorizationCode>();

  async getActiveSigningKey(): Promise<StoredSigningKey | null> {
    return this.signingKey;
  }

  async storeSigningKey(key: StoredSigningKey): Promise<void> {
    this.signingKey = key;
  }

  async registerClient(registration: AnonOAuthClientRegistration): Promise<AnonOAuthClientRegistration> {
    this.clients.set(registration.client_id, registration);
    return registration;
  }

  async getClient(clientId: string): Promise<AnonOAuthClientRegistration | null> {
    return this.clients.get(clientId) ?? null;
  }

  async storeAuthorizationCode(code: AuthorizationCode): Promise<void> {
    this.authorizationCodes.set(code.code, code);
  }

  async consumeAuthorizationCode(code: string): Promise<AuthorizationCode | null> {
    const existing = this.authorizationCodes.get(code) ?? null;
    if (!existing) {
      return null;
    }
    this.authorizationCodes.delete(code);
    return existing;
  }

  async purgeExpiredAuthorizationCodes(now: number): Promise<number> {
    let purged = 0;
    for (const [key, code] of this.authorizationCodes) {
      if (now > code.expiresAt) {
        this.authorizationCodes.delete(key);
        purged += 1;
      }
    }
    return purged;
  }

  async countAuthorizationCodes(): Promise<number> {
    return this.authorizationCodes.size;
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

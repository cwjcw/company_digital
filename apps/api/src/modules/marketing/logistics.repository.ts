import type { LogisticsActor } from './logistics.policy';
export const LOGISTICS_REPOSITORY = Symbol('LOGISTICS_REPOSITORY');
export interface LogisticsSession {
  query(sql: string, params?: unknown[]): Promise<Record<string, any>[]>;
  audit(actor: LogisticsActor, action: string, id: string | null, before: unknown, after: unknown): Promise<void>;
}
export interface LogisticsRepository {
  query(sql: string, params: unknown[]): Promise<Record<string, any>[]>;
  transaction<T>(tenantCode: string, work: (session: LogisticsSession, tenantId: string) => Promise<T>): Promise<T>;
}

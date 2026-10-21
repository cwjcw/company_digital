import type { EntityManager } from "typeorm";

export type NotificationFileDelivery = {
  prepare(manager: EntityManager, tenantId: string, outbox: Record<string, unknown>, workerId: string,
    users: Array<Record<string, unknown>>, render: (payload: Record<string, unknown>) => string): Promise<NotificationClaim[]>;
  attachment(tenantId: string, outboxId: string, attachmentId: string, workerId: string): Promise<{ filename: string; content: Buffer }>;
};

export type NotificationStatus = "PENDING" | "PROCESSING" | "SENT" | "FAILED";

export type NotificationEventDefinition = {
  eventType: string;
  moduleCode: string;
  resourceCode: string;
  label: string;
  conditionDescription: string;
  defaultChannel: string;
  messageType: "text" | "text_file";
  defaultTemplate: string;
  allowedRecipientRules: readonly string[];
  templateVariables: ReadonlyArray<{
    key: string;
    label: string;
  }>;
};

export type NotificationActor = {
  userId: string | null;
};

export type NotificationRuleInput = {
  ruleKey: string;
  name: string;
  eventType: string;
  channel: string;
  resource?: string;
  recipientRule?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
};

export type NotificationRecipientTarget =
  | { type: "ORGANIZATION"; organizationUnitId: string; includeDescendants: boolean }
  | { type: "ROLE"; roleId: string }
  | { type: "USER"; userId: string };

export type NotificationOutboxInput = {
  ruleId?: string | null;
  eventType: string;
  channel: string;
  dedupKey: string;
  payload: Record<string, unknown>;
  createdBy?: string | null;
};

export type NotificationEventInput = {
  eventType: string;
  dedupKey: string;
  payload: Record<string, unknown>;
  channel?: string;
  ruleId?: string | null;
  createdBy?: string | null;
};

export type NotificationEnqueueResult = {
  row: Record<string, unknown>;
  created: boolean;
};

export type NotificationRecipient = {
  deliveryId: string;
  userId: string;
  displayName: string;
  wechatUserId: string;
};

export type NotificationClaim = {
  notificationId: string;
  messageType: "text" | "file" | "text_file";
  attachment?: { id: string; filename: string; downloadPath: string };
  content: string;
  recipients: NotificationRecipient[];
};

export type NotificationDeliveryResult = {
  deliveryId: string;
  providerMessageId?: string;
  errcode?: string;
  errmsg?: string;
};

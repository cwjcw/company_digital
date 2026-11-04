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
  /** Allows a group route alongside the normal personal Work message. */
  allowGroupRoute?: boolean;
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

export type NotificationGroupEventComponent =
  | { type: "text" | "markdown"; content: string }
  | { type: "image"; filename: string; mimeType: "image/png"; base64: string };

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
  userId?: string;
  displayName?: string;
  wechatUserId?: string;
};

export type NotificationClaim = {
  notificationId: string;
  messageType: "text" | "file" | "text_file" | "group_text" | "group_markdown" | "group_image";
  content: string;
  recipients: Array<NotificationRecipient & { targetType?: "USER" | "WECHAT_GROUP_WEBHOOK"; targetId?: string; targetName?: string; webhookUrl?: string }>;
  attachment?: { id: string; filename: string; downloadPath: string; mimeType?: string };
};

export type NotificationDeliveryResult = {
  deliveryId: string;
  providerMessageId?: string;
  errcode?: string;
  errmsg?: string;
};

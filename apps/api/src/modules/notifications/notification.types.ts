export type NotificationStatus = "PENDING" | "PROCESSING" | "SENT" | "FAILED";

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
  messageType: "text";
  content: string;
  recipients: NotificationRecipient[];
};

export type NotificationDeliveryResult = {
  deliveryId: string;
  providerMessageId?: string;
  errcode?: string;
  errmsg?: string;
};

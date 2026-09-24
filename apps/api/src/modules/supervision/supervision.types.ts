import type { SupervisionAttachment } from "../../entities";

export type SupervisionActor = {
  tenantId: string;
  userId: string | null;
  username: string;
  displayName?: string;
  isSystemAdmin?: boolean;
  moduleAdminCodes?: string[];
  permissions: string[];
  tableDataScopes: Array<{
    resource: string; scope: string; match?: string; actions?: string[];
    rules?: Array<{ fieldKey?: string; operator?: string; value?: unknown }>;
  }>;
  requestId: string;
  source?: "web" | "import";
};

export type ProjectInput = {
  projectName: string; sourceType?: string | null; sourceName?: string | null; sourceDate?: string | null;
  ownerId: string; supervisorId: string; departmentId?: string | null; participantIds?: string[];
  priority?: string; plannedStartDate: string; dueDate: string; acceptanceCriteria: string;
  attachments?: SupervisionAttachment[]; expectedVersion?: number;
};

export type TaskInput = {
  projectId: string; taskName: string; description?: string | null; ownerId: string; collaboratorIds?: string[];
  departmentId?: string | null; priority?: string; plannedStartDate?: string | null; dueDate?: string;
  progress?: number; acceptanceCriteria: string; nextFollowupDate?: string | null;
  attachments?: SupervisionAttachment[]; expectedVersion?: number;
};

export type ProgressInput = {
  taskId: string; updateType?: "PROGRESS" | "RISK"; progress?: number | null; summary: string;
  riskIssue?: string | null; nextAction?: string | null; nextFollowupDate?: string | null;
  attachments?: SupervisionAttachment[]; expectedTaskVersion?: number;
};

export type SupervisionPageInput = {
  page?: unknown; pageSize?: unknown; search?: unknown; sortField?: unknown; sortOrder?: unknown; filterGroup?: unknown;
};

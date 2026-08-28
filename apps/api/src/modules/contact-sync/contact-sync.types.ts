export type WecomDepartmentSnapshot = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  path: string[];
  sortOrder: number;
};

export type WecomContactSnapshot = {
  wechatUserId: string;
  employeeNo: string | null;
  name: string;
  position: string | null;
  telephone: string | null;
  mobile: string | null;
  email: string | null;
  alias: string | null;
  gender: string | null;
  directLeaders: string[];
  departmentLeaderExternalIds?: string[];
  departmentPaths: string[][];
  enabled: boolean;
};

export type WecomSyncPayload = {
  capturedAt: string;
  sourceHash: string;
  departments: WecomDepartmentSnapshot[];
  contacts: WecomContactSnapshot[];
};

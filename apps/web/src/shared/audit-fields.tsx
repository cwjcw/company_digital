import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Typography } from "antd";
import dayjs from "dayjs";
import { api } from "../api";
import { auditActorUserLabels, auditPermissionFields, formatAuditActor, isAuditActorField } from "@kdos/contracts";

export type AuditDirectoryUser = { id: string; username: string; displayName: string | null; enabled: boolean };

export const auditLabels: Record<string, string> = {
  createdBy: "创建人",
  createdAt: "创建时间",
  updatedBy: "更新人",
  updatedAt: "更新时间"
};

export const isAuditField = (field: string) => Object.hasOwn(auditLabels, field);

export function useAuditIdentityDirectory() {
  const query = useQuery({
    queryKey: ["audit-identity-directory"],
    queryFn: () => api<AuditDirectoryUser[]>("/directory/users"),
    staleTime: 5 * 60 * 1000,
    retry: false
  });
  const names = useMemo(() => auditActorUserLabels(Array.isArray(query.data) ? query.data : []), [query.data]);
  return names;
}

export const formatAuditUser = formatAuditActor;

export function useAuditColumns() {
  const names = useAuditIdentityDirectory();
  return useMemo(() => auditPermissionFields.map((field) => ({
    title: field.label,
    dataIndex: field.key,
    key: field.key,
    width: isAuditActorField(field) ? 150 : 175,
    render: (value: unknown) => {
      if (isAuditActorField(field)) return formatAuditUser(value, names);
      if (value == null || value === "") return <Typography.Text type="secondary">—</Typography.Text>;
      return dayjs(String(value)).isValid() ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : String(value);
    }
  })), [names]);
}

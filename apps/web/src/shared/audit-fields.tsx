import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Typography } from "antd";
import dayjs from "dayjs";
import { api } from "../api";

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
  const names = useMemo(() => {
    const result = new Map<string, string>();
    for (const user of Array.isArray(query.data) ? query.data : []) {
      const name = user.displayName?.trim() || user.username;
      result.set(user.id, name);
      result.set(user.username, name);
    }
    return result;
  }, [query.data]);
  return names;
}

export function formatAuditUser(value: unknown, names: ReadonlyMap<string, string>) {
  if (value == null || value === "" || value === "system") return "系统";
  const reference = String(value);
  const resolved = names.get(reference);
  if (resolved) return resolved;
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(reference) ? "未知用户" : reference;
}

export function useAuditColumns() {
  const names = useAuditIdentityDirectory();
  return useMemo(() => Object.entries(auditLabels).map(([dataIndex, title]) => ({
    title,
    dataIndex,
    key: dataIndex,
    width: dataIndex.endsWith("By") ? 150 : 175,
    render: (value: unknown) => {
      if (dataIndex.endsWith("By")) return formatAuditUser(value, names);
      if (value == null || value === "") return <Typography.Text type="secondary">—</Typography.Text>;
      return dayjs(String(value)).isValid() ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : String(value);
    }
  })), [names]);
}

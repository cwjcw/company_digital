import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import type { KnowledgePage } from "@kdos/contracts";
import { api } from "../../api";
export function KnowledgePageSelect({
  spaceId,
  value,
  onChange,
  excludeId,
  label = "父页面",
}: {
  spaceId: string;
  value?: string;
  onChange: (id: string | undefined) => void;
  excludeId?: string;
  label?: string;
}) {
  const [search, setSearch] = useState("");
  const rows = useQuery({
    queryKey: ["knowledge", "page-picker", spaceId, search],
    queryFn: () => {
      const p = new URLSearchParams({
        spaceId,
        mode: "working",
        pageSize: "100",
      });
      if (search)
        p.set(
          "filterGroup",
          JSON.stringify({
            logic: "AND",
            rules: [{ field: "title", operator: "contains", value: search }],
          }),
        );
      return api<{ rows: KnowledgePage[]; total: number }>(
        `/knowledge/pages?${p}`,
      );
    },
    enabled: Boolean(spaceId),
    retry: false,
  });
  return (
    <Select
      aria-label={label}
      allowClear
      showSearch
      filterOption={false}
      value={value}
      onChange={onChange}
      onSearch={setSearch}
      placeholder="空间根目录；可搜索父页面标题"
      loading={rows.isFetching}
      options={rows.data?.rows
        .filter((p) => p.id !== excludeId)
        .map((p) => ({ value: p.id, label: p.title }))}
      style={{ width: "100%" }}
      notFoundContent={
        rows.error ? (rows.error as Error).message : "没有可选父页面"
      }
    />
  );
}

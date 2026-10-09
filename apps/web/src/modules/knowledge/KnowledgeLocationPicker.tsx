import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Select, Space } from "antd";
import type { KnowledgeLocationResult, KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgePageSelect } from "./KnowledgePageSelect";
import { knowledgeLocationUrl } from "./knowledge-ui";
import { KnowledgeSpaceIcon } from "./KnowledgeSpaceIcon";
export type KnowledgeLocationValue = { spaceId: string; parentId?: string };
export function KnowledgeLocationPicker({ spaces, value, onChange, disabled, excludeId, onValidityChange }: {
  spaces: KnowledgeSpace[]; value: KnowledgeLocationValue;
  onChange: (value: KnowledgeLocationValue) => void;
  disabled?: boolean; excludeId?: string; onValidityChange?: (valid: boolean) => void;
}) {
  const [changing, setChanging] = useState(false);
  const space = spaces.find((item) => item.id === value.spaceId);
  const selected = useQuery({
    queryKey: ["knowledge", "selected-location", value.spaceId, value.parentId, excludeId],
    queryFn: () => api<KnowledgeLocationResult>(knowledgeLocationUrl(value.spaceId, { selectedId: value.parentId, excludeId })),
    enabled: Boolean(value.parentId), retry: false,
  });
  const target = selected.data?.rows.find((item) => item.id === value.parentId);
  const valid = Boolean(space?.canCreate && (!value.parentId || target));
  useEffect(() => { onValidityChange?.(valid); }, [valid, onValidityChange]);
  const path = value.parentId
    ? target?.breadcrumb?.map((item) => item.title).join(" > ") ?? `${space?.name ?? ""} > ${selected.isFetching ? "正在加载位置…" : "当前位置不可创建知识"}`
    : `${space?.name ?? ""} > 空间根目录`;
  return <div className="knowledge-location-picker">
    <Space wrap style={{ display: "flex", justifyContent: "space-between" }}>
      <span aria-label="保存位置">保存位置：{path}</span>
      <Button type="link" disabled={disabled} onClick={() => setChanging((open) => !open)}>{changing ? "收起位置选择" : "更改位置"}</Button>
    </Space>
    <p className="knowledge-location-help">父页面就是当前知识存放的上一级目录。例如，选择“公司制度”，上传的文件就会放在“公司制度”下面。不选择父页面，则直接保存在当前知识空间的根目录。文件将继承上级位置的查看权限。</p>
    {selected.error && <Alert type="error" message={(selected.error as Error).message} />}
    {changing && <Space direction="vertical" style={{ width: "100%" }}>
      <Select aria-label="保存到知识空间" value={value.spaceId} style={{ width: "100%" }} disabled={disabled}
        options={spaces.filter((item) => item.canCreate).map((item) => ({ value: item.id, label: <Space><KnowledgeSpaceIcon value={item.icon} />{item.name}</Space> }))}
        onChange={(spaceId) => onChange({ spaceId })} />
      <Button disabled={disabled || !space?.canCreate} onClick={() => { onChange({ spaceId: value.spaceId }); setChanging(false); }}>空间根目录</Button>
      {!disabled && <KnowledgePageSelect key={value.spaceId} spaceId={value.spaceId} excludeId={excludeId}
        onChange={(parentId) => { onChange({ spaceId: value.spaceId, parentId }); setChanging(false); }} />}
    </Space>}
  </div>;
}

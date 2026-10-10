import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Select, Space } from "antd";
import type { KnowledgeFolderResult, KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgeFolderSelect, KnowledgeFolderCreate } from "./KnowledgeFolderTree";
import { knowledgeFoldersUrl } from "./knowledge-ui";
import { KnowledgeSpaceIcon } from "./KnowledgeSpaceIcon";
export type KnowledgeLocationValue = { spaceId: string; folderId?: string };
export function KnowledgeLocationPicker({
  spaces,
  value,
  onChange,
  disabled,
  excludeId,
  onValidityChange,
  operation = "create",
  onPathChange,
}: {
  operation?: "upload" | "create" | "import" | "move" | "moveFolder";
  onPathChange?: (path: string) => void;
  spaces: KnowledgeSpace[];
  value: KnowledgeLocationValue;
  onChange: (value: KnowledgeLocationValue) => void;
  disabled?: boolean;
  excludeId?: string;
  onValidityChange?: (valid: boolean) => void;
}) {
  const explanation = {
    upload: "文件将保存到所选空间或文件夹内。",
    create: "新页面将创建在所选位置。",
    import: "转换后的在线文章将创建在所选位置。",
    move: "当前知识及历史子页面将移动到所选文件夹；已发布内容需发布后更新阅读位置。",
    moveFolder: "当前文件夹及其子目录将移动到所选位置。",
  }[operation];
  const [changing, setChanging] = useState(false), [newFolder, setNewFolder] = useState(false);
  const space = spaces.find((item) => item.id === value.spaceId);
  const selected = useQuery({
    queryKey: [
      "knowledge",
      "selected-location",
      value.spaceId,
      value.folderId,
      excludeId,
    ],
    queryFn: () =>
      api<KnowledgeFolderResult>(
        knowledgeFoldersUrl(value.spaceId, {
          selectable: String(operation !== "moveFolder"),
          selectedId: value.folderId,
          excludeId,
        }),
      ),
    enabled: Boolean(value.folderId),
    retry: false,
  });
  const target = selected.data?.rows.find((item) => item.id === value.folderId);
  const valid = Boolean((operation === "moveFolder" ? space?.canEditFolders : space?.canCreate) && (!value.folderId || target));
  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);
  const path = value.folderId
    ? (target?.breadcrumb?.map((item) => item.title).join(" > ") ??
      `${space?.name ?? ""} > ${selected.isFetching ? "正在加载位置…" : "当前位置不可创建知识"}`)
    : `${space?.name ?? ""} > 空间根目录`;
  useEffect(() => {
    onPathChange?.(path);
  }, [path, onPathChange]);
  return (
    <div className="knowledge-location-picker">
      <Space wrap style={{ display: "flex", justifyContent: "space-between" }}>
        <span aria-label="保存位置">保存位置：{path}</span>
        <Button
          type="link"
          disabled={disabled}
          onClick={() => setChanging((open) => !open)}
        >
          {changing ? "收起位置选择" : "更改位置"}
        </Button>
      </Space>
      <p className="knowledge-location-help">
        {explanation}
        不选择文件夹，则保存到空间根目录。文件夹继承知识空间权限；已有知识的权限限制继续生效。
      </p>
      {selected.error && (
        <Alert type="error" message={(selected.error as Error).message} />
      )}
      {newFolder && <KnowledgeFolderCreate spaceId={value.spaceId} parentFolderId={value.folderId} onClose={() => setNewFolder(false)} onCreated={(folderId) => { onChange({spaceId:value.spaceId,folderId}); setNewFolder(false); setChanging(false); }} />}
      {changing && (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            aria-label="保存到知识空间"
            value={value.spaceId}
            style={{ width: "100%" }}
            disabled={disabled}
            options={spaces
              .filter((item) => operation === "moveFolder" ? item.canEditFolders : item.canCreate)
              .map((item) => ({
                value: item.id,
                label: (
                  <Space>
                    <KnowledgeSpaceIcon value={item.icon} />
                    {item.name}
                  </Space>
                ),
              }))}
            onChange={(spaceId) => onChange({ spaceId })}
          />
          <Button
            disabled={disabled || !(operation === "moveFolder" ? space?.canEditFolders : space?.canCreate)}
            onClick={() => {
              onChange({ spaceId: value.spaceId });
              setChanging(false);
            }}
          >
            空间根目录
          </Button>
          {space?.canCreateFolders && <Button disabled={disabled} onClick={() => setNewFolder(true)}>在所选位置新建文件夹</Button>}
          {!disabled && (
            <KnowledgeFolderSelect
              key={value.spaceId}
              spaceId={value.spaceId}
              excludeId={excludeId}
              selectable={operation !== "moveFolder"}
              onSelect={(folderId) => {
                onChange({ spaceId: value.spaceId, folderId });
                setChanging(false);
              }}
            />
          )}
        </Space>
      )}
    </div>
  );
}

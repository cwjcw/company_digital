import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Input, List, Pagination, Tree } from "antd";
import type { KnowledgeLocationResult } from "@kdos/contracts";
import { api } from "../../api";
import { knowledgeLocationUrl } from "./knowledge-ui";
function LocationBranch({ spaceId, parentId, excludeId, onSelect }: {
  spaceId: string; parentId?: string; excludeId?: string;
  onSelect: (id: string, path: string) => void;
}) {
  const [page, setPage] = useState(1), [expanded, setExpanded] = useState<string[]>([]);
  const rows = useQuery({
    queryKey: ["knowledge", "location-tree", spaceId, parentId, excludeId, page],
    queryFn: () => api<KnowledgeLocationResult>(knowledgeLocationUrl(spaceId, {
      parentId, excludeId, page: String(page), pageSize: "100",
    })), retry: false,
  });
  if (rows.error) return <Alert type="error" message={(rows.error as Error).message} />;
  return <>
    <Tree aria-label="保存位置页面树" expandedKeys={expanded} selectable={false}
      onExpand={(keys) => setExpanded(keys.map(String))} treeData={rows.data?.rows.map((row) => {
        const path = row.breadcrumb?.map((item) => item.title).join(" > ") ?? row.title;
        return { key: row.id, title: <Button type="text" title={path} onClick={() => onSelect(row.id, path)}>{row.title}</Button>,
          isLeaf: !row.hasChildren,
          children: row.hasChildren && expanded.includes(row.id) ? [{ key: `${row.id}:children`, title:
            <LocationBranch spaceId={spaceId} parentId={row.id} excludeId={excludeId} onSelect={onSelect} />, selectable: false }] : row.hasChildren ? [{ key: `${row.id}:load`, title: "展开加载", selectable: false }] : undefined };
      })} />
    {!rows.isFetching && rows.data?.total === 0 && <p>当前层级没有可选页面，可选择空间根目录。</p>}
    {rows.isFetching && <p>正在加载位置…</p>}
    {(rows.data?.total ?? 0) > 100 && <Pagination size="small" current={page} pageSize={100} total={rows.data?.total} showSizeChanger={false} onChange={setPage} />}
  </>;
}
export function KnowledgePageSelect({ spaceId, excludeId, onChange }: {
  spaceId: string; excludeId?: string;
  onChange: (id: string | undefined, path?: string) => void;
}) {
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const rows = useQuery({
    queryKey: ["knowledge", "location-search", spaceId, excludeId, search, page],
    queryFn: () => api<KnowledgeLocationResult>(knowledgeLocationUrl(spaceId, {
      search, excludeId, page: String(page), pageSize: "100",
    })), enabled: Boolean(search.trim()), retry: false,
  });
  return <>
    <Input.Search aria-label="搜索保存位置" placeholder="搜索父页面" value={search}
      onChange={(event) => { setSearch(event.target.value); setPage(1); }} allowClear />
    {search.trim() ? <>
      {rows.error && <Alert type="error" message={(rows.error as Error).message} />}
      <List loading={rows.isFetching} dataSource={rows.data?.rows} locale={{ emptyText: "没有匹配的可创建位置" }}
        renderItem={(row) => {
          const path = row.breadcrumb?.map((item) => item.title).join(" > ") ?? row.title;
          return <List.Item><Button type="link" onClick={() => onChange(row.id, path)}>{path}</Button></List.Item>;
        }} />
      {(rows.data?.total ?? 0) > 100 && <Pagination current={page} pageSize={100} total={rows.data?.total} showSizeChanger={false} onChange={setPage} />}
    </> : <LocationBranch key={spaceId} spaceId={spaceId} excludeId={excludeId} onSelect={onChange} />}
  </>;
}

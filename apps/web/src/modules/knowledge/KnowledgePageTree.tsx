import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Empty, Spin, Tag, Tree } from "antd";
import type { DataNode } from "antd/es/tree";
import type { KnowledgePage, KnowledgeSpace, KnowledgePageResult } from "@kdos/contracts";
import { api } from "../../api";
type PageResult = KnowledgePageResult;
function LoadMore({ load }: { load: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  return <Button size="small" loading={busy} onClick={() => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    void load().finally(() => { running.current = false; setBusy(false); });
  }}>加载更多</Button>;
}
const appendTree = (
  old: DataNode[],
  parent: string | undefined,
  more: DataNode[],
): DataNode[] =>
  parent
    ? old.map((n) =>
        String(n.key) === parent
          ? {
              ...n,
              children: [
                ...(n.children ?? []).filter(
                  (c) => !String(c.key).startsWith("more:"),
                ),
                ...more,
              ],
            }
          : {
              ...n,
              ...(n.children
                ? { children: appendTree(n.children, parent, more) }
                : {}),
            },
      )
    : [...old.filter((n) => !String(n.key).startsWith("more:")), ...more];
export function KnowledgePageTree({
  space,
  working,
  refresh,
  onOpen,
}: {
  space: KnowledgeSpace;
  working: boolean;
  refresh: number;
  onOpen: (page: KnowledgePage) => void;
}) {
  const [nodes, setNodes] = useState<DataNode[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const open = useRef(onOpen);
  useEffect(() => { open.current = onOpen; }, [onOpen]);
  const load = useCallback(
    async (parentId?: string, page = 1): Promise<DataNode[]> => {
      const p = new URLSearchParams({
        mode: working ? "working" : "published",
        pageSize: "100",
        page: String(page),
      });
      if (parentId) p.set("parentId", parentId);
      const result = await api<PageResult>(
        `/knowledge/spaces/${space.id}/tree?${p}`,
      );
      const rows: DataNode[] = result.rows.map((row) => ({
        key: row.id,
        isLeaf: !row.hasChildren,
        title: (
          <button className="knowledge-tree-link" onClick={() => open.current(row)}>
            {row.title}
            {row.status === "DRAFT" && <Tag>草稿</Tag>}
          </button>
        ),
      }));
      if (page * 100 < result.total)
        rows.push({
          key: `more:${parentId ?? "root"}:${page}`,
          isLeaf: true,
          title: (
            <LoadMore load={async () => {
              const current = generation.current;
              try {
                const more = await load(parentId, page + 1);
                if (current === generation.current) setNodes((old) => appendTree(old, parentId, more));
              } catch (e) {
                if (current === generation.current) setError((e as Error).message);
              }
            }} />
          ),
        });
      return rows;
    },
    [space.id, working],
  );
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setNodes([]);
    setBusy(true);
    setError("");
    void load()
      .then((rows) => {
        if (active && current === generation.current) setNodes(rows);
      })
      .catch((e) => {
        if (active && current === generation.current) setError((e as Error).message);
      })
      .finally(() => {
        if (active && current === generation.current) setBusy(false);
      });
    return () => { active = false; };
  }, [load, refresh, retry]);
  return error ? (
    <Alert type="error" message={error} action={<Button onClick={() => setRetry((n) => n + 1)}>重试</Button>} />
  ) : busy ? (
    <Spin />
  ) : !nodes.length ? <Empty description="暂无可见知识" /> : (
    <Tree
      blockNode
      treeData={nodes}
      loadData={async (node) => {
        if (String(node.key).startsWith("more:")) return;
        const current = generation.current;
        try {
          const children = await load(String(node.key));
          if (current === generation.current) setNodes((old) => appendTree(old, String(node.key), children));
        } catch (e) {
          if (current === generation.current) setError((e as Error).message);
        }
      }}
    />
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Tag,
} from "antd";
import type { KnowledgeAccessEntry, KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import {
  hasFieldPermission,
  hasResourcePermission,
  KdosDataTable,
  TablePermissionButton,
} from "../../shared/KdosDataTable";
import {
  blankPlatformQuery,
  platformRowsUrl,
  type PlatformTableQuery,
} from "../../shared/platform-table";
import { KnowledgeAccess } from "./KnowledgeAccess";
export function KnowledgeSettings() {
  const [query, setQuery] = useState<PlatformTableQuery>(blankPlatformQuery()),
    [editing, setEditing] = useState<Partial<KnowledgeSpace>>(),
    [access, setAccess] = useState<{
      row: KnowledgeSpace;
      entries: KnowledgeAccessEntry[];
    }>(),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp(),
    client = useQueryClient();
  const rows = useQuery({
    queryKey: ["knowledge", "space-settings", query],
    queryFn: () =>
      api<{ rows: KnowledgeSpace[]; total: number }>(
        platformRowsUrl("knowledge-spaces", query),
      ),
    retry: false,
  });
  const manageable = useQuery({
    queryKey: ["knowledge", "all-spaces"],
    queryFn: () =>
      api<KnowledgeSpace[]>("/knowledge/spaces?includeArchived=true"),
    retry: false,
  });
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["knowledge"] });
  const show = (row: Partial<KnowledgeSpace>) => {
    setEditing(row);
    form.setFieldsValue({
      code: "",
      name: "",
      description: "",
      icon: "book",
      sortOrder: 0,
      ...row,
    });
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const values = await form.validateFields();
      await api(`/knowledge/spaces${editing.id ? `/${editing.id}` : ""}`, {
        method: editing.id ? "PATCH" : "POST",
        body: JSON.stringify({
          ...Object.fromEntries(
            Object.entries(values).filter(
              ([field]) =>
                !editing.id ||
                hasFieldPermission("knowledge-spaces", field, "update"),
            ),
          ),
          ...(editing.id ? { expectedVersion: editing.version } : {}),
        }),
      });
      setEditing(undefined);
      refresh();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = async (row: KnowledgeSpace) => {
    try {
      await api(`/knowledge/spaces/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: row.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
          expectedVersion: row.version,
        }),
      });
      refresh();
    } catch (e) {
      message.error((e as Error).message);
    }
  };
  if (!hasResourcePermission("knowledge-spaces", "read"))
    return <Alert type="warning" message="没有空间查看权限" />;
  return (
    <>
      <KdosDataTable<KnowledgeSpace>
        resource="knowledge-spaces"
        rowKey="id"
        dataSource={rows.data?.rows}
        loading={rows.isLoading}
        serverData={{ total: rows.data?.total ?? 0, onQueryChange: setQuery }}
        toolbar={
          <Space>
            {hasResourcePermission("knowledge-spaces", "create") && (
              <Button type="primary" onClick={() => show({})}>
                新建空间
              </Button>
            )}
            <TablePermissionButton resource="knowledge-spaces" />
            <TablePermissionButton resource="knowledge-pages" />
          </Space>
        }
        columns={[
          {
            title: "空间名称",
            dataIndex: "name",
            width: 240,
            render: (name, row) => (
              <Space>
                <span>{name}</span>
                {manageable.data?.find((s) => s.id === row.id)?.canManage &&
                  hasResourcePermission("knowledge-spaces", "update") && (
                    <>
                      <Button size="small" onClick={() => show(row)}>
                        编辑
                      </Button>
                      {hasFieldPermission(
                        "knowledge-spaces",
                        "access",
                        "read",
                      ) &&
                        hasFieldPermission(
                          "knowledge-spaces",
                          "access",
                          "update",
                        ) && (
                          <Button
                            size="small"
                            onClick={() =>
                              void api<KnowledgeAccessEntry[]>(
                                `/knowledge/spaces/${row.id}/access`,
                              )
                                .then((entries) => setAccess({ row, entries }))
                                .catch((e) =>
                                  message.error((e as Error).message),
                                )
                            }
                          >
                            成员
                          </Button>
                        )}
                      {hasFieldPermission(
                        "knowledge-spaces",
                        "status",
                        "update",
                      ) && (
                        <Button
                          size="small"
                          onClick={() => void changeStatus(row)}
                        >
                          {row.status === "ACTIVE" ? "归档" : "恢复"}
                        </Button>
                      )}
                    </>
                  )}
              </Space>
            ),
          },
          { title: "空间编码", dataIndex: "code", width: 120 },
          { title: "说明", dataIndex: "description", width: 250 },
          { title: "顺序", dataIndex: "sortOrder", width: 80 },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (s) => <Tag>{s === "ACTIVE" ? "启用" : "已归档"}</Tag>,
          },
        ]}
      />
      {rows.error && (
        <Alert type="error" message={(rows.error as Error).message} />
      )}
      <Modal
        open={Boolean(editing)}
        title={editing?.id ? "编辑空间" : "新建空间"}
        onCancel={() => setEditing(undefined)}
        onOk={() => void save()}
        confirmLoading={busy}
      >
        <Form form={form} layout="vertical">
          {["code", "name", "description", "icon"]
            .filter(
              (k) =>
                !editing?.id ||
                hasFieldPermission("knowledge-spaces", k, "update"),
            )
            .map((k) => (
              <Form.Item
                key={k}
                name={k}
                label={
                  (
                    {
                      code: "编码",
                      name: "名称",
                      description: "说明",
                      icon: "图标",
                    } as Record<string, string>
                  )[k]
                }
                rules={[{ required: ["code", "name"].includes(k) }]}
              >
                <Input />
              </Form.Item>
            ))}
          <Form.Item name="sortOrder" label="顺序">
            <InputNumber
              disabled={Boolean(
                editing?.id &&
                !hasFieldPermission("knowledge-spaces", "sortOrder", "update"),
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
      {access && (
        <KnowledgeAccess
          kind="space"
          id={access.row.id}
          version={access.row.version}
          entries={access.entries}
          onClose={() => setAccess(undefined)}
          onSaved={() => {
            setAccess(undefined);
            refresh();
          }}
        />
      )}
    </>
  );
}

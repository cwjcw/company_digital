import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Modal, Select, Space, Switch } from "antd";
import {
  knowledgeAccessLevelOptions,
  type KnowledgeAccessEntry,
} from "@kdos/contracts";
import { api } from "../../api";
type Options = {
  users: { id: string; label: string }[];
  organizations: { id: string; label: string }[];
  roles: { id: string; label: string }[];
};
export function KnowledgeAccess({
  kind,
  id,
  version,
  entries,
  restricted = true,
  onClose,
  onSaved,
}: {
  kind: "space" | "page";
  id: string;
  version: number;
  entries: KnowledgeAccessEntry[];
  restricted?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(entries),
    [limited, setLimited] = useState(restricted),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api(
        `/knowledge/${kind === "space" ? "spaces" : "pages"}/${id}/access`,
        {
          method: "PATCH",
          body: JSON.stringify({
            entries: value,
            ...(kind === "page" ? { restricted: limited } : {}),
            expectedVersion: version,
          }),
        },
      );
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={kind === "space" ? "空间成员与权限" : "页面权限"}
      open
      onCancel={onClose}
      onOk={() => void save()}
      confirmLoading={busy}
      width={720}
    >
      <Alert
        type="info"
        message={
          kind === "page"
            ? "页面权限只能收紧空间及所有上级权限。给子页面添加成员不会扩大上级授权。"
            : "空间权限同时受平台表权限、字段权限和数据范围约束。"
        }
      />
      {error && <Alert type="error" message={error} />}
      {kind === "page" && (
        <Space style={{ margin: "16px 0" }}>
          <Switch checked={limited} onChange={setLimited} />
          <span>{limited ? "进一步限制成员" : "继承上级权限"}</span>
        </Space>
      )}
      {(kind === "space" || limited) && (
        <KnowledgeAccessFields value={value} onChange={setValue} />
      )}
    </Modal>
  );
}

export function KnowledgeAccessFields({
  value,
  onChange,
}: {
  value: KnowledgeAccessEntry[];
  onChange: (entries: KnowledgeAccessEntry[]) => void;
}) {
  const options = useQuery({
    queryKey: ["knowledge", "members"],
    queryFn: () => api<Options>("/knowledge/options"),
    retry: false,
  });
  const change = (index: number, patch: Partial<KnowledgeAccessEntry>) =>
    onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <>
      {options.error && (
        <Alert type="error" message={(options.error as Error).message} />
      )}{" "}
      <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
        {value.map((e, index) => {
          const targets =
            e.subjectType === "USER"
              ? options.data?.users
              : e.subjectType === "ROLE"
                ? options.data?.roles
                : options.data?.organizations;
          return (
            <Space key={index} wrap>
              <Select
                aria-label={`权限对象类型${index + 1}`}
                value={e.subjectType}
                style={{ width: 100 }}
                options={[
                  { value: "ALL", label: "全公司" },
                  { value: "USER", label: "人员" },
                  { value: "ROLE", label: "角色" },
                  { value: "ORGANIZATION", label: "组织" },
                ]}
                onChange={(subjectType) =>
                  change(index, { subjectType, subjectId: null })
                }
              />
              {e.subjectType !== "ALL" && (
                <Select
                  aria-label={`权限对象${index + 1}`}
                  value={e.subjectId}
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 220 }}
                  options={targets?.map((t) => ({
                    value: t.id,
                    label: t.label,
                  }))}
                  onChange={(subjectId) => change(index, { subjectId })}
                />
              )}
              <Select
                value={e.accessLevel}
                style={{ width: 130 }}
                options={knowledgeAccessLevelOptions}
                onChange={(accessLevel) => change(index, { accessLevel })}
              />
              <Button
                danger
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                移除
              </Button>
            </Space>
          );
        })}
        <Button
          onClick={() =>
            onChange([
              ...value,
              { subjectType: "USER", subjectId: null, accessLevel: "VIEWER" },
            ])
          }
        >
          添加成员
        </Button>
      </Space>
    </>
  );
}

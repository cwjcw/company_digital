import { Button, Space } from "antd";
import {
  BookOutlined, FileTextOutlined, FolderOutlined, TeamOutlined,
  ApartmentOutlined, CalendarOutlined, SettingOutlined, ToolOutlined,
  DesktopOutlined, CheckCircleOutlined, SafetyOutlined, DollarOutlined,
  ReadOutlined, ExperimentOutlined,
} from "@ant-design/icons";
const icons = [
  { value: "book", label: "书本", Icon: BookOutlined },
  { value: "file", label: "文件", Icon: FileTextOutlined },
  { value: "folder", label: "文件夹", Icon: FolderOutlined },
  { value: "people", label: "人员", Icon: TeamOutlined },
  { value: "organization", label: "组织", Icon: ApartmentOutlined },
  { value: "calendar", label: "日历", Icon: CalendarOutlined },
  { value: "settings", label: "设置", Icon: SettingOutlined },
  { value: "production", label: "生产", Icon: ToolOutlined },
  { value: "equipment", label: "设备", Icon: DesktopOutlined },
  { value: "quality", label: "质量", Icon: CheckCircleOutlined },
  { value: "safety", label: "安全", Icon: SafetyOutlined },
  { value: "finance", label: "财务", Icon: DollarOutlined },
  { value: "training", label: "培训", Icon: ReadOutlined },
  { value: "research", label: "研发", Icon: ExperimentOutlined },
];
export function KnowledgeSpaceIcon({ value }: { value?: string }) {
  const { Icon } = icons.find((icon) => icon.value === value) ?? icons[0]!;
  return <Icon />;
}
export function KnowledgeSpaceIconPicker({ value = "book", onChange, disabled }: {
  value?: string; onChange?: (value: string) => void; disabled?: boolean;
}) {
  return <div>
    <Space wrap role="group" aria-label="空间图标">
      {icons.map(({ value: key, label, Icon }) => <Button key={key} aria-label={label}
        aria-pressed={value === key} type={value === key ? "primary" : "default"}
        disabled={disabled} icon={<Icon />} onClick={() => onChange?.(key)}>{label}</Button>)}
    </Space>
    <p aria-label="图标预览"><KnowledgeSpaceIcon value={value} /> {icons.find((icon) => icon.value === value)?.label ?? "书本"}</p>
  </div>;
}

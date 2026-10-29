import { useEffect, useState, type ReactNode } from "react";
import { App, Button, Flex, Modal, Space, Typography } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined, FullscreenExitOutlined, FullscreenOutlined, DeleteOutlined, EditOutlined, PrinterOutlined } from "@ant-design/icons";
import "./kdos-record-detail.css";

export type KdosRecordDetailTarget<RecordType> = { record: RecordType; index: number; total: number };

export function KdosRecordDetailModal<RecordType>({
  open, target, title, children, onClose, onNavigate, onEdit, onPrint, onDelete
}: {
  open: boolean;
  target: KdosRecordDetailTarget<RecordType> | null;
  title: (record: RecordType) => string;
  children: ReactNode;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => Promise<KdosRecordDetailTarget<RecordType> | null>;
  onEdit?: () => void;
  onPrint?: () => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { modal, message } = App.useApp();
  const [maximized, setMaximized] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { if (!open) setMaximized(false); }, [open]);

  const navigate = async (direction: -1 | 1) => {
    if (navigating || !target) return;
    setNavigating(true);
    try {
      if (!await onNavigate(direction)) message.info("当前记录已是筛选结果中的边界记录");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取详情失败");
    } finally { setNavigating(false); }
  };
  const print = async () => {
    if (!onPrint || printing) return;
    setPrinting(true);
    try { await onPrint(); }
    catch (error) { message.error(error instanceof Error ? error.message : "打印失败，请稍后重试"); }
    finally { setPrinting(false); }
  };
  const remove = () => {
    if (!onDelete || !target || deleting) return;
    modal.confirm({
      title: `确认删除「${title(target.record)}」？`,
      content: "删除会按当前业务关联和权限规则校验，操作将被记录。",
      okText: "删除", cancelText: "取消", okButtonProps: { danger: true },
      onOk: async () => {
        setDeleting(true);
        try { await onDelete(); onClose(); }
        catch (error) { message.error(error instanceof Error ? error.message : "删除失败，请稍后重试"); throw error; }
        finally { setDeleting(false); }
      }
    });
  };

  return <Modal
    className="kdos-record-detail-modal"
    open={open && Boolean(target)}
    title={null}
    centered={!maximized}
    width={maximized ? "100vw" : 1100}
    style={maximized ? { top: 0, paddingBottom: 0, maxWidth: "100vw" } : { paddingBottom: 0, maxWidth: "calc(100vw - 32px)" }}
    styles={{ body: { height: maximized ? "calc(100vh - 56px)" : "calc(84vh - 56px)", overflow: "auto" } }}
    footer={null}
    closable={false}
    destroyOnHidden
    onCancel={onClose}
    keyboard
    maskClosable={false}
  >
    {target && <>
      <Flex className="kdos-record-detail-topbar" align="center" justify="space-between" gap={16}>
        <Space size={12}>
          <Button aria-label="上一条" icon={<ArrowLeftOutlined />} disabled={target.index <= 1 || navigating} loading={navigating} onClick={() => void navigate(-1)} />
          <Typography.Text aria-live="polite">{target.index} / {target.total}</Typography.Text>
          <Button aria-label="下一条" icon={<ArrowRightOutlined />} disabled={target.index >= target.total || navigating} onClick={() => void navigate(1)} />
        </Space>
        <Space>
          <Button aria-label={maximized ? "恢复原状" : "最大化"} icon={maximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={() => setMaximized((value) => !value)} />
          <Button aria-label="关闭详情" icon={<CloseOutlined />} onClick={onClose} />
        </Space>
      </Flex>
      <Flex className="kdos-record-detail-actions" align="center" justify="space-between" gap={12} wrap>
        <Typography.Title level={4} className="kdos-record-detail-title">{title(target.record)}</Typography.Title>
        <Space wrap>
          {onPrint && <Button icon={<PrinterOutlined />} loading={printing} onClick={() => void print()}>打印</Button>}
          {onEdit && <Button icon={<EditOutlined />} onClick={onEdit}>编辑</Button>}
          {onDelete && <Button danger icon={<DeleteOutlined />} loading={deleting} onClick={remove}>删除</Button>}
        </Space>
      </Flex>
      <div className="kdos-record-detail-content">{children}</div>
    </>}
  </Modal>;
}

import {
  ApartmentOutlined, ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined, CalendarOutlined, DashboardOutlined,
  DatabaseOutlined, HolderOutlined, ShopOutlined, SettingOutlined, UserOutlined
} from "@ant-design/icons";
import { App as AntApp, Button, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { api } from "../../api";

const { Text, Title } = Typography;

export type PortalModule = {
  id: "cockpit" | "planning" | "data" | "marketing" | "hr" | "workflow" | "system" | "profile";
  title: string;
  englishTitle: string;
  description: string;
  features: string[];
  path: string;
  tone: string;
};
export type PortalModuleId = PortalModule["id"];

export const portalModules: PortalModule[] = [
  {
    id: "cockpit", title: "公司驾驶舱", englishTitle: "COMPANY COCKPIT",
    description: "聚合经营与交付关键指标，快速掌握公司运行状态。",
    features: ["销售接单汇总大屏", "经营指标"], path: "/sales-summary-dashboard", tone: "indigo"
  },
  {
    id: "planning", title: "主计划", englishTitle: "MASTER PLANNING",
    description: "统一管理销售接单、月度排产与生产报工。",
    features: ["销售接单明细", "月度计划", "报工表"], path: "/sales-summary-details", tone: "teal"
  },
  {
    id: "data", title: "数据中心", englishTitle: "DATA CENTER",
    description: "集中管理订单与入库基础业务数据，为计划与分析提供统一来源。",
    features: ["订单表", "入库表", "出库表"], path: "/data-center/sales-orders", tone: "cyan"
  },
  {
    id: "marketing", title: "营销中心", englishTitle: "MARKETING CENTER",
    description: "维护业务客户归属并安排未来两周订单优先级。",
    features: ["业务客户对应", "订单排期"], path: "/marketing/business-customers", tone: "rose"
  },
  {
    id: "hr", title: "人力资源", englishTitle: "HUMAN RESOURCES",
    description: "按人力资源六大模块组织员工全生命周期业务与文件。",
    features: ["六大模块", "离职人员检查"], path: "/hr/employee-relations/departure-check", tone: "teal"
  },
  {
    id: "workflow", title: "流程审批", englishTitle: "WORKFLOW",
    description: "承载公司业务需求、审批流转与开发过程协同。",
    features: ["需求提报与审批", "审批流程配置"], path: "/development-requests", tone: "orange"
  },
  {
    id: "system", title: "系统管理", englishTitle: "SYSTEM ADMIN",
    description: "维护基础资料、系统审计、用户角色与接口账户。",
    features: ["员工与部门", "角色权限", "系统审计"], path: "/users", tone: "blue"
  },
  {
    id: "profile", title: "个人中心", englishTitle: "MY WORKSPACE",
    description: "查看个人账户信息，维护登录密码与个人安全设置。",
    features: ["账户资料", "安全设置"], path: "/profile", tone: "violet"
  }
];

const moduleIcons = {
  cockpit: <DashboardOutlined />,
  planning: <CalendarOutlined />,
  data: <DatabaseOutlined />,
  marketing: <ShopOutlined />,
  hr: <UserOutlined />,
  workflow: <ApartmentOutlined />,
  system: <SettingOutlined />,
  profile: <UserOutlined />
};

const defaultPortalModuleOrder = portalModules.map((module) => module.id);

function normalizePortalModuleOrder(value: unknown): PortalModuleId[] {
  const requested = Array.isArray(value) ? value : [];
  const unique = requested.filter((id, index): id is PortalModuleId =>
    typeof id === "string" && defaultPortalModuleOrder.includes(id as PortalModuleId) && requested.indexOf(id) === index
  );
  return [...unique, ...defaultPortalModuleOrder.filter((id) => !unique.includes(id))];
}

export function BrandLogo({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return <div className={`kn-brand${compact ? " kn-brand-compact" : ""}${inverse ? " kn-brand-inverse" : ""}`}>
    <span className="kn-logo-symbol"><span>K</span><i /><span>N</span></span>
    {!compact && <span className="kn-brand-copy"><strong>凯南数字化工作台</strong><small>KAINAN DIGITAL OS</small></span>}
  </div>;
}

export function ModulePortal({ user, onOpen, onLogout }: {
  user: any;
  onOpen: (module: PortalModule) => void;
  onLogout: () => void;
}) {
  const { message } = AntApp.useApp();
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const [moduleOrder, setModuleOrder] = useState<PortalModuleId[]>(() => normalizePortalModuleOrder(user.portalModuleOrder));
  const [draftOrder, setDraftOrder] = useState<PortalModuleId[]>(moduleOrder);
  const [ordering, setOrdering] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [draggingId, setDraggingId] = useState<PortalModuleId | null>(null);
  const canSee = (module: PortalModule) => module.id !== "system" || user.roles?.includes("系统管理员");
  const orderedModules = (ordering ? draftOrder : moduleOrder).map((id) => portalModules.find((module) => module.id === id)!).filter(Boolean);
  const visibleModules = orderedModules.filter(canSee);
  const mergeVisibleOrder = (visibleOrder: PortalModuleId[]) => {
    const visibleIds = new Set(visibleModules.map((module) => module.id));
    let index = 0;
    setDraftOrder((current) => current.map((id) => visibleIds.has(id) ? visibleOrder[index++]! : id));
  };
  const moveModule = (id: PortalModuleId, delta: number) => {
    const ids = visibleModules.map((module) => module.id);
    const from = ids.indexOf(id); const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    mergeVisibleOrder(ids);
  };
  const dropModule = (targetId: PortalModuleId) => {
    if (!draggingId || draggingId === targetId) return;
    const ids = visibleModules.map((module) => module.id).filter((id) => id !== draggingId);
    const targetIndex = ids.indexOf(targetId);
    ids.splice(targetIndex < 0 ? ids.length : targetIndex, 0, draggingId);
    mergeVisibleOrder(ids);
    setDraggingId(null);
  };
  const saveModuleOrder = async () => {
    setSavingOrder(true);
    try {
      const result = await api<{ order: PortalModuleId[] }>("/auth/preferences/portal-modules", { method: "PUT", body: JSON.stringify({ order: draftOrder }) });
      const savedOrder = normalizePortalModuleOrder(result.order);
      setModuleOrder(savedOrder); setDraftOrder(savedOrder); setOrdering(false);
      try {
        const sessionUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
        localStorage.setItem("sessionUser", JSON.stringify({ ...sessionUser, portalModuleOrder: savedOrder }));
      } catch { /* A malformed local session must not invalidate the server-side preference. */ }
      message.success("模块顺序已保存");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "模块顺序保存失败");
    } finally { setSavingOrder(false); }
  };
  return <div className="module-portal">
    <header className="portal-header">
      <BrandLogo />
      <div className="portal-account">
        <span className="portal-avatar">{String(user.displayName ?? user.username ?? "K").slice(0, 1)}</span>
        <span><Text strong>{user.displayName ?? user.username}</Text><small>{user.roles?.join(" / ") || "企业用户"}</small></span>
        <Button type="text" onClick={onLogout}>退出</Button>
      </div>
    </header>
    <main className="portal-main">
      <section className="portal-intro">
        <div>
          <Text className="portal-eyebrow">WORKSPACE · 工作模块</Text>
          <Title level={1}>{greeting}，{user.displayName ?? user.username}</Title>
        </div>
        <div className="portal-intro-actions">
          {ordering ? <Space wrap>
            <Typography.Text className="portal-order-hint">拖动卡片或使用箭头调整顺序</Typography.Text>
            <Button onClick={() => setDraftOrder(defaultPortalModuleOrder)}>恢复默认</Button>
            <Button onClick={() => { setDraftOrder(moduleOrder); setOrdering(false); }}>取消</Button>
            <Button type="primary" loading={savingOrder} onClick={() => void saveModuleOrder()}>保存顺序</Button>
          </Space> : <Button icon={<HolderOutlined />} aria-label="调整顺序" onClick={() => { setDraftOrder(moduleOrder); setOrdering(true); }}>调整顺序</Button>}
          <div className="portal-date"><strong>{new Date().getDate()}</strong><span>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", weekday: "long" }).format(new Date())}</span></div>
        </div>
      </section>
      <section className="portal-module-grid" aria-label="工作模块">
        {visibleModules.map((module, index) => {
          const content = <>
            <span className="portal-module-top"><span className="portal-module-icon">{moduleIcons[module.id]}</span>{ordering ? <span className="portal-module-sort-controls">
              <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={index === 0} aria-label={`上移${module.title}`} onClick={() => moveModule(module.id, -1)} />
              <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={index === visibleModules.length - 1} aria-label={`下移${module.title}`} onClick={() => moveModule(module.id, 1)} />
              <HolderOutlined className="portal-module-drag-handle" />
            </span> : <ArrowRightOutlined className="portal-module-arrow" />}</span>
            <span className="portal-module-name"><small>{module.englishTitle}</small><strong>{module.title}</strong></span>
            <span className="portal-module-description">{module.description}</span>
            <span className="portal-module-features">{module.features.map((feature) => <Tag key={feature}>{feature}</Tag>)}</span>
          </>;
          return ordering
            ? <div key={module.id} draggable className={`portal-module-card portal-module-card-ordering portal-tone-${module.tone}${draggingId === module.id ? " dragging" : ""}`} aria-label={`排列${module.title}`}
                onDragStart={() => setDraggingId(module.id)} onDragEnd={() => setDraggingId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropModule(module.id)}>{content}</div>
            : <button type="button" key={module.id} className={`portal-module-card portal-tone-${module.tone}`} onClick={() => onOpen(module)} aria-label={`进入${module.title}`}>{content}</button>;
        })}
        {!ordering && <div className="portal-module-placeholder" aria-label="预留模块位置"><span>+</span><strong>更多业务模块</strong><small>为后续扩展预留</small></div>}
      </section>
      <footer className="portal-footer"><span>KN · Digital Operating System</span><span>模块中心 V1.0</span></footer>
    </main>
  </div>;
}

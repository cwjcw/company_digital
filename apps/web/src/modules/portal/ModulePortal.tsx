import {
  ApartmentOutlined, ArrowRightOutlined, CalendarOutlined, DashboardOutlined,
  DatabaseOutlined, ShopOutlined, SettingOutlined, UserOutlined
} from "@ant-design/icons";
import { Button, Tag, Typography } from "antd";

const { Text, Title } = Typography;

export type PortalModule = {
  id: "cockpit" | "planning" | "data" | "marketing" | "workflow" | "system" | "profile";
  title: string;
  englishTitle: string;
  description: string;
  features: string[];
  path: string;
  tone: string;
};

export const portalModules: PortalModule[] = [
  {
    id: "cockpit", title: "公司驾驶舱", englishTitle: "COMPANY COCKPIT",
    description: "聚合经营与交付关键指标，快速掌握公司运行状态。",
    features: ["销售接单汇总大屏", "经营指标"], path: "/sales-summary-dashboard", tone: "indigo"
  },
  {
    id: "planning", title: "主计划", englishTitle: "MASTER PLANNING",
    description: "统一管理销售接单、月度排产与每日生产进度。",
    features: ["销售接单明细", "月度计划", "日进度"], path: "/sales-summary-details", tone: "teal"
  },
  {
    id: "data", title: "数据中心", englishTitle: "DATA CENTER",
    description: "集中管理订单与入库基础业务数据，为计划与分析提供统一来源。",
    features: ["订单表", "入库表"], path: "/data-center/sales-orders", tone: "cyan"
  },
  {
    id: "marketing", title: "营销中心", englishTitle: "MARKETING CENTER",
    description: "维护业务客户归属并安排未来两周订单优先级。",
    features: ["业务客户对应", "订单排期"], path: "/marketing/business-customers", tone: "rose"
  },
  {
    id: "workflow", title: "流程审批", englishTitle: "WORKFLOW",
    description: "承载公司业务需求、审批流转与开发过程协同。",
    features: ["需求提报与审批", "审批流程配置"], path: "/development-requests", tone: "orange"
  },
  {
    id: "system", title: "系统管理", englishTitle: "SYSTEM ADMIN",
    description: "维护基础资料、系统审计、用户角色与接口账户。",
    features: ["基础资料", "系统管理", "账户与接口"], path: "/master-data", tone: "blue"
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
  workflow: <ApartmentOutlined />,
  system: <SettingOutlined />,
  profile: <UserOutlined />
};

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
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
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
          <Text type="secondary">选择一个模块开始工作。所有模块统一呈现，后续新增能力将在这里持续扩展。</Text>
        </div>
        <div className="portal-date"><strong>{new Date().getDate()}</strong><span>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", weekday: "long" }).format(new Date())}</span></div>
      </section>
      <section className="portal-module-grid" aria-label="工作模块">
        {portalModules.map((module) => <button type="button" key={module.id} className={`portal-module-card portal-tone-${module.tone}`} onClick={() => onOpen(module)} aria-label={`进入${module.title}`}>
          <span className="portal-module-top"><span className="portal-module-icon">{moduleIcons[module.id]}</span><ArrowRightOutlined className="portal-module-arrow" /></span>
          <span className="portal-module-name"><small>{module.englishTitle}</small><strong>{module.title}</strong></span>
          <span className="portal-module-description">{module.description}</span>
          <span className="portal-module-features">{module.features.map((feature) => <Tag key={feature}>{feature}</Tag>)}</span>
        </button>)}
        <div className="portal-module-placeholder" aria-label="预留模块位置"><span>+</span><strong>更多业务模块</strong><small>为后续扩展预留</small></div>
      </section>
      <footer className="portal-footer"><span>KN · Digital Operating System</span><span>模块中心 V1.0</span></footer>
    </main>
  </div>;
}

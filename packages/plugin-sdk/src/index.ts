export interface KdosNavigationItem { key: string; label: string; path: string; icon?: string; }
export interface KdosRouteDefinition { path: string; permission: string; }
export interface KdosPluginManifest {
  id: string; name: string; version: string;
  navigation: KdosNavigationItem[];
  routes: KdosRouteDefinition[];
  permissions: readonly string[];
  events: readonly string[];
  workflows: readonly string[];
  aiTools: readonly string[];
}

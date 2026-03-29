export type {
  ExecutorFrontendPlugin,
  ExecutorPluginNavigation,
  ExecutorPluginRouteContextValue,
  FrontendPluginRouteDefinition,
  FrontendPluginRouteParams,
  FrontendPluginRouteSearch,
  SecretStoreCreateFormProps,
  SecretStoreFrontendDefinition,
  SourcePluginNavigation,
  SourcePluginRouteParams,
  SourcePluginRouteSearch,
} from "./types";

export {
  createExecutorPluginPaths,
  createSourcePluginPaths,
  executorPluginBasePath,
  executorPluginRoutePath,
  executorPluginRoutePattern,
  normalizeExecutorPluginPath,
  normalizeSourcePluginPath,
  sourcePluginAddPath,
  sourcePluginChildPath,
  sourcePluginChildPattern,
  sourcePluginDetailPath,
  sourcePluginDetailPattern,
  sourcePluginEditPath,
  sourcePluginEditPattern,
  sourcePluginsIndexPath,
  type ExecutorPluginPaths,
  type SourcePluginPaths,
} from "./paths";

export {
  defineExecutorFrontendPlugin,
  defineFrontendPluginRoute,
  registerExecutorFrontendPlugins,
  type RegisteredFrontendPluginRoute,
} from "./registry";

export {
  ExecutorPluginRouteProvider,
  useExecutorPlugin,
  useExecutorPluginNavigation,
  useExecutorPluginPaths,
  useExecutorPluginRoute,
  useExecutorPluginRouteDefinition,
  useExecutorPluginRouteParams,
  useExecutorPluginSearch,
} from "./plugin-route-context";

export {
  useSourcePlugin,
  useSourcePluginNavigation,
  useSourcePluginPaths,
  useSourcePluginRoute,
  useSourcePluginRouteParams,
  useSourcePluginSearch,
} from "./route-context";

export {
  cn,
} from "./lib/cn";

export {
  CodeBlock,
} from "./components/code-block";
export {
  DocumentPanel,
} from "./components/document-panel";
export {
  IconCheck,
  IconChevron,
  IconClose,
  IconCopy,
  IconEmpty,
  IconFolder,
  IconPencil,
  IconSearch,
  IconSpinner,
  IconTool,
} from "./components/icons";
export {
  EmptyState,
  LoadableBlock,
} from "./components/loadable";
export {
  Markdown,
} from "./components/markdown";
export {
  SourceToolExplorer,
} from "./components/source-tool-explorer";
export {
  type SourceToolExplorerSearch,
  parseSourceToolExplorerSearch,
} from "./components/source-tool-explorer-search";
export {
  SourceToolDetailPanel,
  SourceToolDiscoveryPanel,
  SourceToolModelWorkbench,
  type SourceToolDetailPanelProps,
  type SourceToolDiscoveryResult,
} from "./components/source-tool-workbench";

// ── UI primitives (shadcn/ui) ────────────────────────────────────────────
export { Alert, alertVariants, AlertTitle, AlertDescription, AlertAction } from "./components/ui/alert";
export { Badge, badgeVariants, MethodBadge, type BadgeProps } from "./components/ui/badge";
export { Button, buttonVariants, type ButtonProps } from "./components/ui/button";
export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent } from "./components/ui/card";
export { Input } from "./components/ui/input";
export { Label } from "./components/ui/label";
export { Select } from "./components/ui/select";
export { Separator } from "./components/ui/separator";
export { Textarea } from "./components/ui/textarea";
export { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator } from "./components/ui/command";

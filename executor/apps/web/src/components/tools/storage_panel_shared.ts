export type CreateStorageArgs = {
  scopeType: "scratch" | "account" | "workspace" | "organization";
  durability: "ephemeral" | "durable";
  purpose?: string;
  ttlHours?: number;
};

export type StorageDirectoryEntry = {
  name: string;
  type: "file" | "directory" | "symlink" | "unknown";
  size?: number;
  mtime?: number;
};

export type StorageSqlResult = {
  mode: "read" | "write";
  rows?: Record<string, unknown>[];
  rowCount: number;
  changes?: number;
};

export type StorageSqlObject = {
  name: string;
  type: "table" | "view" | "unknown";
};

export const USER_TABLES_QUERY = [
  "SELECT name",
  "FROM sqlite_master",
  "WHERE type = 'table'",
  "  AND name NOT LIKE 'sqlite_%'",
  "  AND name NOT IN ('fs_config', 'fs_data', 'fs_dentry', 'fs_inode', 'fs_symlink', 'kv_store')",
  "ORDER BY name",
].join("\n");

export const ALL_OBJECTS_QUERY = "SELECT name, type FROM sqlite_master ORDER BY name";
export const KV_DATA_QUERY = "SELECT key, value, updated_at FROM kv_store ORDER BY key LIMIT 200";
export const FS_ENTRIES_QUERY = "SELECT * FROM fs_dentry LIMIT 200";
export const SQL_OBJECTS_QUERY = "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name";

const INTERNAL_SQL_OBJECT_NAMES = new Set([
  "fs_config",
  "fs_data",
  "fs_dentry",
  "fs_inode",
  "fs_symlink",
  "kv_store",
  "sqlite_sequence",
]);

export const jsonViewerStyles = {
  container: "json-viewer-container",
  basicChildStyle: "json-viewer-child",
  label: "json-viewer-label",
  clickableLabel: "json-viewer-clickable-label",
  nullValue: "json-viewer-null",
  undefinedValue: "json-viewer-undefined",
  numberValue: "json-viewer-number",
  stringValue: "json-viewer-string",
  booleanValue: "json-viewer-boolean",
  otherValue: "json-viewer-other",
  punctuation: "json-viewer-punctuation",
  expandIcon: "json-viewer-expand",
  collapseIcon: "json-viewer-collapse",
  collapsedContent: "json-viewer-collapsed",
  childFieldsContainer: "json-viewer-fields",
  noQuotesForStringValues: false,
  quotesForFieldNames: true,
  stringifyStringValues: true,
  ariaLables: {
    collapseJson: "Collapse",
    expandJson: "Expand",
  },
} as const;

export function prettyBytes(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let bytes = value;
  let index = 0;
  while (bytes >= 1024 && index < units.length - 1) {
    bytes /= 1024;
    index += 1;
  }
  const precision = bytes >= 100 || index === 0 ? 0 : 1;
  return `${bytes.toFixed(precision)} ${units[index]}`;
}

export function asLocalDate(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function relativeTime(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  const seconds = Math.floor((Date.now() - value) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function joinStoragePath(basePath: string, name: string): string {
  const base = (basePath.trim() || "/").replace(/\/+$/, "");
  if (!base || base === "/") {
    return `/${name}`;
  }
  return `${base}/${name}`;
}

export function previewJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxChars))}\n\n...truncated...`;
}

export function sqlCellText(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return previewJson(value);
}

export function collectSqlColumns(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }
  return columns;
}

export function isInternalSqlObject(name: string): boolean {
  if (INTERNAL_SQL_OBJECT_NAMES.has(name)) {
    return true;
  }
  if (name.startsWith("fs_")) {
    return true;
  }
  return name.startsWith("sqlite_");
}

export function sqlObjectType(value: unknown): "table" | "view" | "unknown" {
  if (value === "table" || value === "view") {
    return value;
  }
  return "unknown";
}

export function escapeSqlIdentifier(value: string): string {
  return value.replaceAll('"', '""');
}

export function isJsonLike(content: string): boolean {
  const trimmed = content.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export function tryParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function shouldExpandJsonNode(level: number): boolean {
  return level < 2;
}

export function scopeColor(scope: string): string {
  switch (scope) {
    case "scratch": return "text-muted-foreground";
    case "account": return "text-terminal-cyan";
    case "workspace": return "text-terminal-green";
    case "organization": return "text-terminal-amber";
    default: return "text-muted-foreground";
  }
}

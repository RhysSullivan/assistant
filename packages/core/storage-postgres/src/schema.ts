import {
  pgTable,
  text,
  jsonb,
  boolean,
  timestamp,
  integer,
  primaryKey,
  index,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const sources = pgTable(
  "sources",
  {
    id: text("id").notNull(),
    scopeId: text("scope_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.scopeId] })],
);

export const tools = pgTable(
  "tools",
  {
    id: text("id").notNull(),
    scopeId: text("scope_id").notNull(),
    sourceId: text("source_id").notNull(),
    pluginKey: text("plugin_key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    mayElicit: boolean("may_elicit").default(false),
    inputSchema: jsonb("input_schema").$type<unknown>(),
    outputSchema: jsonb("output_schema").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.scopeId] }),
    index("idx_tools_source").on(t.scopeId, t.sourceId),
  ],
);

export const toolDefinitions = pgTable(
  "tool_definitions",
  {
    name: text("name").notNull(),
    scopeId: text("scope_id").notNull(),
    schema: jsonb("schema").$type<unknown>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.name, t.scopeId] })],
);

export const secrets = pgTable(
  "secrets",
  {
    id: text("id").notNull(),
    scopeId: text("scope_id").notNull(),
    name: text("name").notNull(),
    purpose: text("purpose"),
    provider: text("provider"),
    encryptedValue: bytea("encrypted_value"),
    iv: bytea("iv"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.scopeId] })],
);

export const policies = pgTable(
  "policies",
  {
    id: text("id").notNull(),
    scopeId: text("scope_id").notNull(),
    name: text("name").notNull(),
    action: text("action").notNull(),
    matchToolPattern: text("match_tool_pattern"),
    matchSourceId: text("match_source_id"),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.scopeId] })],
);

export const pluginKv = pgTable(
  "plugin_kv",
  {
    scopeId: text("scope_id").notNull(),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeId, t.namespace, t.key] }),
    index("idx_plugin_kv_namespace").on(t.scopeId, t.namespace),
  ],
);

import { defineSchema, defineTable, type TablesFromSchemaDefinition } from "@executor-v2/confect";
import {
  ApprovalSchema,
  EventEnvelopeSchema,
  OAuthTokenSchema,
  OrganizationMembershipSchema,
  OrganizationSchema,
  PolicySchema,
  ProfileSchema,
  SourceCredentialBindingSchema,
  SourceSchema,
  StorageInstanceSchema,
  SyncStateSchema,
  TaskRunSchema,
  WorkspaceSchema,
} from "@executor-v2/schema";
import * as Schema from "effect/Schema";

const StorageFileEntrySchema = Schema.Struct({
  id: Schema.String,
  storageInstanceId: Schema.String,
  path: Schema.String,
  contentBase64: Schema.String,
  sizeBytes: Schema.Number,
  updatedAt: Schema.Number,
});

const StorageKvEntrySchema = Schema.Struct({
  id: Schema.String,
  storageInstanceId: Schema.String,
  key: Schema.String,
  valueJson: Schema.String,
  updatedAt: Schema.Number,
});

const StorageSqlKvEntrySchema = Schema.Struct({
  id: Schema.String,
  storageInstanceId: Schema.String,
  key: Schema.String,
  value: Schema.String,
  updatedAt: Schema.Number,
});

const ArtifactSchema = Schema.Struct({
  id: Schema.String,
  protocol: Schema.String,
  contentHash: Schema.String,
  extractorVersion: Schema.String,
  toolCount: Schema.Number,
  refHintTableJson: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

const ArtifactToolSchema = Schema.Struct({
  id: Schema.String,
  artifactId: Schema.String,
  protocol: Schema.String,
  toolId: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  canonicalPath: Schema.String,
  operationHash: Schema.String,
  invocationJson: Schema.String,
  inputSchemaJson: Schema.optional(Schema.NullOr(Schema.String)),
  outputSchemaJson: Schema.optional(Schema.NullOr(Schema.String)),
  metadataJson: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

const ArtifactSchemaRefSchema = Schema.Struct({
  id: Schema.String,
  artifactId: Schema.String,
  refKey: Schema.String,
  schemaJson: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

const SourceArtifactBindingSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  sourceId: Schema.String,
  artifactId: Schema.String,
  updatedAt: Schema.Number,
});

const SourceIngestArtifactBatchSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  sourceId: Schema.String,
  artifactId: Schema.String,
  protocol: Schema.String,
  batchIndex: Schema.Number,
  toolsJson: Schema.String,
  updatedAt: Schema.Number,
});

const WorkspaceToolIndexSchema = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  sourceId: Schema.String,
  sourceName: Schema.String,
  sourceKind: Schema.String,
  artifactId: Schema.String,
  toolId: Schema.String,
  protocol: Schema.String,
  method: Schema.String,
  namespace: Schema.String,
  path: Schema.String,
  pathLower: Schema.String,
  normalizedPath: Schema.String,
  operationPath: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  searchText: Schema.String,
  operationHash: Schema.String,
  approvalMode: Schema.String,
  status: Schema.String,
  refHintTableJson: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.Number,
});

export const executorConfectSchema = defineSchema({
  profiles: defineTable(ProfileSchema).index("by_domainId", ["id"]),
  organizations: defineTable(OrganizationSchema)
    .index("by_domainId", ["id"])
    .index("by_slug", ["slug"]),
  organizationMemberships: defineTable(OrganizationMembershipSchema)
    .index("by_domainId", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId", ["accountId"])
    .index("by_organizationId_accountId", ["organizationId", "accountId"]),
  workspaces: defineTable(WorkspaceSchema)
    .index("by_domainId", ["id"])
    .index("by_organizationId", ["organizationId"])
    .index("by_createdByAccountId", ["createdByAccountId"]),
  sources: defineTable(SourceSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"]),
  artifacts: defineTable(ArtifactSchema)
    .index("by_domainId", ["id"])
    .index("by_protocol_contentHash_extractorVersion", [
      "protocol",
      "contentHash",
      "extractorVersion",
    ]),
  artifactTools: defineTable(ArtifactToolSchema)
    .index("by_domainId", ["id"])
    .index("by_artifactId", ["artifactId"])
    .index("by_artifactId_toolId", ["artifactId", "toolId"]),
  artifactSchemaRefs: defineTable(ArtifactSchemaRefSchema)
    .index("by_domainId", ["id"])
    .index("by_artifactId", ["artifactId"])
    .index("by_artifactId_refKey", ["artifactId", "refKey"]),
  sourceArtifactBindings: defineTable(SourceArtifactBindingSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sourceId", ["workspaceId", "sourceId"])
    .index("by_artifactId", ["artifactId"]),
  sourceIngestArtifactBatches: defineTable(SourceIngestArtifactBatchSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId_sourceId", ["workspaceId", "sourceId"])
    .index("by_workspaceId_sourceId_artifactId_batchIndex", [
      "workspaceId",
      "sourceId",
      "artifactId",
      "batchIndex",
    ])
    .index("by_artifactId", ["artifactId"]),
  workspaceToolIndex: defineTable(WorkspaceToolIndexSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sourceId", ["workspaceId", "sourceId"])
    .index("by_workspaceId_namespace", ["workspaceId", "namespace"])
    .index("by_workspaceId_pathLower", ["workspaceId", "pathLower"])
    .index("by_workspaceId_normalizedPath", ["workspaceId", "normalizedPath"])
    .index("by_workspaceId_operationHash", ["workspaceId", "operationHash"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["workspaceId", "sourceId", "status", "namespace"],
    }),
  sourceCredentialBindings: defineTable(SourceCredentialBindingSchema)
    .index("by_domainId", ["id"])
    .index("by_credentialId", ["credentialId"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId", ["accountId"])
    .index("by_sourceKey", ["sourceKey"]),
  oauthTokens: defineTable(OAuthTokenSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId", ["accountId"])
    .index("by_sourceId", ["sourceId"]),
  policies: defineTable(PolicySchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"]),
  storageInstances: defineTable(StorageInstanceSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_organizationId", ["organizationId"]),
  storageFileEntries: defineTable(StorageFileEntrySchema)
    .index("by_domainId", ["id"])
    .index("by_storageInstanceId", ["storageInstanceId"])
    .index("by_storageInstanceId_path", ["storageInstanceId", "path"]),
  storageKvEntries: defineTable(StorageKvEntrySchema)
    .index("by_domainId", ["id"])
    .index("by_storageInstanceId", ["storageInstanceId"])
    .index("by_storageInstanceId_key", ["storageInstanceId", "key"]),
  storageSqlKvEntries: defineTable(StorageSqlKvEntrySchema)
    .index("by_domainId", ["id"])
    .index("by_storageInstanceId", ["storageInstanceId"])
    .index("by_storageInstanceId_key", ["storageInstanceId", "key"]),
  approvals: defineTable(ApprovalSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_taskRunId", ["taskRunId"])
    .index("by_taskRunId_callId", ["taskRunId", "callId"]),
  taskRuns: defineTable(TaskRunSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_sessionId", ["sessionId"]),
  syncStates: defineTable(SyncStateSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"]),
  events: defineTable(EventEnvelopeSchema)
    .index("by_domainId", ["id"])
    .index("by_workspaceId", ["workspaceId"])
    .index("by_workspaceId_sequence", ["workspaceId", "sequence"]),
});

export type ExecutorConfectTables = TablesFromSchemaDefinition<typeof executorConfectSchema>;

export default executorConfectSchema.convexSchemaDefinition;

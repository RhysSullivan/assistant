export {
  ControlPlaneApi,
  RemoveSourceResultSchema,
  ResolveApprovalPayloadSchema,
  ResolveApprovalStatusSchema,
  UpsertSourcePayloadSchema,
  controlPlaneOpenApiSpec,
  type RemoveSourceResult,
  type ResolveApprovalPayload,
  type UpsertSourcePayload,
} from "./api";

export {
  ControlPlaneBadRequestError,
  ControlPlaneForbiddenError,
  ControlPlaneStorageError,
  ControlPlaneUnauthorizedError,
} from "./errors";

export {
  ControlPlaneService,
  makeControlPlaneService,
  type ControlPlaneServiceShape,
} from "./service";

export {
  ControlPlaneApiLive,
  ControlPlaneActorResolverLive,
  makeControlPlaneWebHandler,
} from "./http";

export {
  ControlPlaneActorResolver,
  type ControlPlaneActorResolverShape,
  type ResolveWorkspaceActorInput,
} from "./auth/actor-resolver";

export {
  ControlPlaneAuthHeaders,
  readPrincipalFromHeaders,
  requirePrincipalFromHeaders,
} from "./auth/principal";

export { deriveWorkspaceMembershipsForPrincipal } from "./auth/workspace-membership";

export {
  ControlPlaneSourcesLive,
  makeControlPlaneSourcesService,
  type ControlPlaneSourcesServiceShape,
  type RemoveSourceInput,
  type UpsertSourceInput,
} from "./sources";

export {
  ControlPlaneApprovalsLive,
  makeControlPlaneApprovalsService,
  type ControlPlaneApprovalsServiceShape,
  type ResolveApprovalInput,
} from "./approvals";

export {
  createControlPlaneAtomClient,
  makeControlPlaneClient,
  type ControlPlaneAtomClient,
  type ControlPlaneClientError,
  type ControlPlaneClientOptions,
} from "./client";

export {
  SourceCatalog,
  SourceCatalogLive,
  SourceCatalogValidationError,
  makeSourceCatalogService,
  type RemoveSourceRequest,
  type RemoveSourceResult as CatalogRemoveSourceResult,
  type SourceCatalogService,
  type UpsertSourcePayload as CatalogUpsertSourcePayload,
  type UpsertSourceRequest,
} from "./source-catalog";

export {
  SourceManager,
  SourceManagerLive,
  OpenApiExtractionError,
  extractOpenApiManifest,
  makeSourceManagerService,
  refreshOpenApiArtifact,
  type RefreshOpenApiArtifactRequest,
  type RefreshOpenApiArtifactResult,
  type SourceManagerService,
  type ToolManifestDiff,
} from "./source-manager";

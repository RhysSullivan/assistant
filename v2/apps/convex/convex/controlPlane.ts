import {
  listApprovals as listApprovalsImpl,
  resolveApproval as resolveApprovalImpl,
} from "./control_plane/approvals";
import { controlPlaneHttpHandler as controlPlaneHttpHandlerImpl } from "./control_plane/http";
import {
  listSources as listSourcesImpl,
  removeSource as removeSourceImpl,
  upsertSource as upsertSourceImpl,
} from "./control_plane/sources";

export const listSources = listSourcesImpl;
export const upsertSource = upsertSourceImpl;
export const removeSource = removeSourceImpl;
export const listApprovals = listApprovalsImpl;
export const resolveApproval = resolveApprovalImpl;

export const controlPlaneHttpHandler = controlPlaneHttpHandlerImpl;

import {
  listSources as listSourcesImpl,
  removeSource as removeSourceImpl,
  upsertSource as upsertSourceImpl,
} from "./control_plane/sources";
import { controlPlaneHttpHandler as controlPlaneHttpHandlerImpl } from "./control_plane/http";

export const listSources = listSourcesImpl;
export const upsertSource = upsertSourceImpl;
export const removeSource = removeSourceImpl;

export const controlPlaneHttpHandler = controlPlaneHttpHandlerImpl;

import type { TaskEventRecord } from "./types";

export type LiveTaskEvent = Pick<TaskEventRecord, "id" | "eventName" | "type" | "payload" | "createdAt">;

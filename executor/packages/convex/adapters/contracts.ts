import type { Id as ConvexId, TableNames } from "../_generated/dataModel.d.ts";
import type { Id as DomainId } from "../../core/src/types";

type AnyConvexTableName = TableNames | "_storage";

export function toDomainId<TableName extends AnyConvexTableName>(id: ConvexId<TableName>): DomainId<TableName> {
  return id as unknown as DomainId<TableName>;
}

export function toConvexId<TableName extends AnyConvexTableName>(id: DomainId<TableName>): ConvexId<TableName> {
  return id as unknown as ConvexId<TableName>;
}

declare module "sql.js/dist/sql-asm.js" {
  type SqlJsRow = Array<string | number | null>;

  export interface SqlJsQueryResult {
    columns: string[];
    values: SqlJsRow[];
  }

  export interface SqlJsDatabase {
    run(sql: string, params?: Array<string | number | null>): void;
    exec(sql: string, params?: Array<string | number | null>): SqlJsQueryResult[];
    export(): Uint8Array;
    getRowsModified(): number;
    close(): void;
  }

  export interface SqlJsModule {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  const initialize: (options?: unknown) => Promise<SqlJsModule>;
  export default initialize;
}

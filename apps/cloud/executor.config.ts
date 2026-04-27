import { executorSchemaConfig } from "../shared/executor-schema-config";

export default executorSchemaConfig({ dialect: "pg", allowStdioMcp: false, workosVault: true });

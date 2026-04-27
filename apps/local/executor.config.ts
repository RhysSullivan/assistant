import { executorSchemaConfig } from "../shared/executor-schema-config";

export default executorSchemaConfig({ dialect: "sqlite", allowStdioMcp: true, googleDiscovery: true });

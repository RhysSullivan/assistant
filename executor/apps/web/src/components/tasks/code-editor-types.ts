import type { ToolDescriptor } from "@/lib/types";

interface NamespaceNode {
  children: Map<string, NamespaceNode>;
  tools: ToolDescriptor[];
}

function buildTree(tools: ToolDescriptor[]): NamespaceNode {
  const root: NamespaceNode = { children: new Map(), tools: [] };
  for (const tool of tools) {
    const parts = tool.path.split(".");
    if (parts.length === 1) {
      root.tools.push(tool);
    } else {
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.children.has(parts[i])) {
          node.children.set(parts[i], { children: new Map(), tools: [] });
        }
        node = node.children.get(parts[i])!;
      }
      node.tools.push(tool);
    }
  }
  return root;
}

function countAllTools(node: NamespaceNode): number {
  let count = node.tools.length;
  for (const child of node.children.values()) {
    count += countAllTools(child);
  }
  return count;
}

function emitToolMethod(tool: ToolDescriptor, dtsSources: Set<string>): string {
  const funcName = tool.path.split(".").pop()!;
  const approvalNote =
    tool.approval === "required"
      ? " **Requires approval** - execution will pause until approved."
      : "";
  const desc = tool.description
    ? `${tool.description}${approvalNote}`
    : approvalNote || "Call this tool.";

  const hasSourceDts = Boolean(tool.source && dtsSources.has(tool.source));
  if (tool.operationId && hasSourceDts) {
    const opKey = JSON.stringify(tool.operationId);
    return `  /**
   * ${desc}
   *${tool.source ? ` @source ${tool.source}` : ""}
   */
  ${funcName}(input: ToolInput<operations[${opKey}]>): Promise<ToolOutput<operations[${opKey}]>>;`;
  }

  const strictArgsType = tool.strictArgsType?.trim();
  const strictReturnsType = tool.strictReturnsType?.trim();
  const fallbackArgsType = tool.argsType?.trim();
  const fallbackReturnsType = tool.returnsType?.trim();
  const hasArgsType = Boolean(strictArgsType || fallbackArgsType);
  const argsType = strictArgsType || fallbackArgsType || "Record<string, unknown>";
  const returnsType = strictReturnsType || fallbackReturnsType || "unknown";
  const inputParam = !hasArgsType || argsType === "{}" ? `input?: ${argsType}` : `input: ${argsType}`;

  return `  /**
   * ${desc}
   *${tool.source ? ` @source ${tool.source}` : ""}
   */
  ${funcName}(${inputParam}): Promise<${returnsType}>;`;
}

function emitNamespaceInterface(
  name: string,
  node: NamespaceNode,
  dtsSources: Set<string>,
  out: string[],
): void {
  for (const [childName, childNode] of node.children) {
    emitNamespaceInterface(`${name}_${childName}`, childNode, dtsSources, out);
  }

  const members: string[] = [];

  for (const [childName, childNode] of node.children) {
    const toolCount = childNode.tools.length + countAllTools(childNode);
    members.push(`  /** ${toolCount} tool${toolCount !== 1 ? "s" : ""} in the \`${childName}\` namespace */
  readonly ${childName}: ToolNS_${name}_${childName};`);
  }

  for (const tool of node.tools) {
    members.push(emitToolMethod(tool, dtsSources));
  }

  out.push(`interface ToolNS_${name} {\n${members.join("\n\n")}\n}`);
}

export function generateToolsDts(tools: ToolDescriptor[], dtsSources: Set<string>): string {
  const root = buildTree(tools);

  const interfaces: string[] = [];
  for (const [name, node] of root.children) {
    emitNamespaceInterface(name, node, dtsSources, interfaces);
  }

  const rootMembers: string[] = [];
  for (const [name] of root.children) {
    rootMembers.push(`  readonly ${name}: ToolNS_${name};`);
  }
  for (const tool of root.tools) {
    rootMembers.push(emitToolMethod(tool, dtsSources));
  }

  let dts = `
/**
 * The \`tools\` object is a proxy that lets you call registered executor tools.
 * Each call returns a Promise with the tool's result.
 * Tools marked with "approval: required" will pause execution until approved.
 */
`;

  dts += interfaces.join("\n\n") + "\n\n";
  dts += `interface ToolsProxy {\n${rootMembers.join("\n\n")}\n}\n\n`;
  dts += "declare const tools: ToolsProxy;\n";

  return dts;
}

export const OPENAPI_HELPER_TYPES = `
type _Normalize<T> = Exclude<T, undefined | null>;
type _OrEmpty<T> = [_Normalize<T>] extends [never] ? {} : _Normalize<T>;
type _Simplify<T> = { [K in keyof T]: T[K] } & {};
type _ParamsOf<Op> =
  Op extends { parameters: infer P } ? P :
  Op extends { parameters?: infer P } ? P :
  never;
type _ParamAt<Op, K extends "query" | "path" | "header" | "cookie"> =
  _ParamsOf<Op> extends { [P in K]?: infer V } ? V : never;
type _BodyOf<Op> =
  Op extends { requestBody?: infer B } ? B :
  Op extends { requestBody: infer B } ? B :
  never;
type _BodyContent<B> =
  B extends { content: infer C }
    ? C extends Record<string, infer V> ? V : never
    : never;
type ToolInput<Op> = _Simplify<
  _OrEmpty<_ParamAt<Op, "query">> &
  _OrEmpty<_ParamAt<Op, "path">> &
  _OrEmpty<_ParamAt<Op, "header">> &
  _OrEmpty<_ParamAt<Op, "cookie">> &
  _OrEmpty<_BodyContent<_BodyOf<Op>>>
>;
type _ResponsesOf<Op> = Op extends { responses: infer R } ? R : never;
type _RespAt<Op, Code extends PropertyKey> =
  _ResponsesOf<Op> extends { [K in Code]?: infer R } ? R : never;
type _ResponsePayload<R> =
  [R] extends [never] ? never :
  R extends { content: infer C }
    ? C extends Record<string, infer V> ? V : unknown
    : R extends { schema: infer S } ? S : unknown;
type _HasStatus<Op, Code extends PropertyKey> =
  [_RespAt<Op, Code>] extends [never] ? false : true;
type _PayloadAt<Op, Code extends PropertyKey> =
  Code extends 204 | 205
    ? (_HasStatus<Op, Code> extends true ? void : never)
    : _ResponsePayload<_RespAt<Op, Code>>;
type _FirstKnown<T extends readonly unknown[]> =
  T extends readonly [infer H, ...infer Rest]
    ? [H] extends [never] ? _FirstKnown<Rest> : H
    : unknown;
type ToolOutput<Op> = _FirstKnown<[
  _PayloadAt<Op, 200>,
  _PayloadAt<Op, 201>,
  _PayloadAt<Op, 202>,
  _PayloadAt<Op, 203>,
  _PayloadAt<Op, 204>,
  _PayloadAt<Op, 205>,
  _PayloadAt<Op, 206>,
  _PayloadAt<Op, 207>,
  _PayloadAt<Op, 208>,
  _PayloadAt<Op, 226>,
  _PayloadAt<Op, "default">,
  unknown
]>;
`;

export const BASE_ENVIRONMENT_DTS = `
interface Console {
  /** Console output is discarded; use explicit return values for results. */
  log(...args: any[]): void;
  /** Console output is discarded; use explicit return values for results. */
  error(...args: any[]): void;
  /** Console output is discarded; use explicit return values for results. */
  warn(...args: any[]): void;
  info(...args: any[]): void;
  debug(...args: any[]): void;
}
declare var console: Console;

declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function clearTimeout(id: number): void;
declare function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function clearInterval(id: number): void;
`;

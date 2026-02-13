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

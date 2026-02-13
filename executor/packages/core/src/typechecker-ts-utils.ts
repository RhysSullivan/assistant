import { Result } from "better-result";

export function getTypeScriptModule(): typeof import("typescript") | null {
  const loaded = Result.try(() => require("typescript") as typeof import("typescript"));
  return loaded.isOk() ? loaded.value : null;
}

export function getSourceFileParseDiagnostics(
  sourceFile: import("typescript").SourceFile,
): import("typescript").Diagnostic[] {
  return (
    sourceFile as { parseDiagnostics?: import("typescript").Diagnostic[] }
  ).parseDiagnostics ?? [];
}

export function unwrapExpression(
  expression: import("typescript").Expression,
  ts: typeof import("typescript"),
): import("typescript").Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isPartiallyEmittedExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

export function propertyNameText(
  name: import("typescript").PropertyName,
  ts: typeof import("typescript"),
): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const expression = unwrapExpression(name.expression, ts);
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)) {
      return expression.text;
    }
  }
  return null;
}

export function indentBlock(text: string, indent = "  "): string {
  return text
    .split("\n")
    .map((line) => (line.trim().length === 0 ? "" : `${indent}${line}`))
    .join("\n");
}

#!/usr/bin/env bun
// Fail CI when code discriminates Effect-owned data by reading the internal
// `_tag` field directly. Effect provides public predicates/helpers instead:
// Option.isSome/isNone, Either.isLeft/isRight, Exit.isSuccess/isFailure,
// Cause predicates/matchers, and Result predicates.
//
// Scope is intentionally targeted and import-aware. This is not a blanket ban
// on domain-owned discriminated unions. A file is checked only when it imports
// one of Option/Either/Result/Cause/Exit from Effect, and violations are direct
// `_tag` comparisons against known Effect tags from the v4 migration.
//
// Run: `bun run scripts/check-effect-internal-tags.ts`
// Exits 1 with a punch list when violations exist.

import { Glob } from "bun";
import ts from "typescript";

const ROOTS = ["packages", "apps"];
const EFFECT_MODULES = new Set(["Option", "Either", "Result", "Cause", "Exit"]);

const TAG_MODULES = new Map<string, readonly string[]>([
  ["Some", ["Option"]],
  ["None", ["Option"]],
  ["Left", ["Either", "Result"]],
  ["Right", ["Either", "Result"]],
  ["Success", ["Exit", "Result"]],
  ["Failure", ["Exit", "Result"]],
  ["Fail", ["Cause"]],
  ["Die", ["Cause"]],
  ["Interrupt", ["Cause"]],
  ["Sequential", ["Cause"]],
  ["Parallel", ["Cause"]],
  ["Then", ["Cause"]],
  ["Both", ["Cause"]],
  ["Empty", ["Cause"]],
]);

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly tag: string;
  readonly access: string;
  readonly helpers: readonly string[];
}

const violations: Violation[] = [];

for (const root of ROOTS) {
  const glob = new Glob(`${root}/**/*.{ts,tsx}`);
  for await (const path of glob.scan({ cwd: import.meta.dir + "/.." })) {
    if (path.includes("node_modules") || path.endsWith(".d.ts")) continue;

    const text = await Bun.file(`${import.meta.dir}/../${path}`).text();
    if (!text.includes("_tag")) continue;

    const sourceFile = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const importedEffectModules = getImportedEffectModules(sourceFile);
    if (importedEffectModules.size === 0) continue;

    visit(sourceFile, (node) => {
      const directComparison = getDirectTagComparison(node);
      if (!directComparison) return;

      const helpers = TAG_MODULES.get(directComparison.tag);
      if (!helpers?.some((helper) => importedEffectModules.has(helper))) return;

      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        directComparison.access.getStart(sourceFile),
      );
      violations.push({
        file: path,
        line: line + 1,
        column: character + 1,
        tag: directComparison.tag,
        access: directComparison.access.getText(sourceFile),
        helpers,
      });
    });
  }
}

if (violations.length === 0) {
  console.log("✓ Effect internal _tag check passed");
  process.exit(0);
}

console.error(
  `✗ Effect internal _tag check failed — ${violations.length} direct Effect tag check(s):\n`,
);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}:${v.column} — ${v.access} === "${v.tag}"`);
}
console.error(
  `\nUse Effect's public predicates/helpers instead of internal _tag discrimination.\n` +
    `This check is intentionally scoped to files importing ${[...EFFECT_MODULES].join(", ")} from Effect\n` +
    `and comparisons against known Effect tags, so domain-owned discriminated unions remain allowed.`,
);
process.exit(1);

function getImportedEffectModules(sourceFile: ts.SourceFile): Set<string> {
  const imported = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const moduleName = statement.moduleSpecifier.text;
    if (moduleName.startsWith("effect/")) {
      const submodule = moduleName.slice("effect/".length);
      if (EFFECT_MODULES.has(submodule)) imported.add(submodule);
    }

    if (moduleName !== "effect") continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (EFFECT_MODULES.has(importedName)) imported.add(importedName);
    }
  }

  return imported;
}

function getDirectTagComparison(
  node: ts.Node,
): { readonly access: ts.PropertyAccessExpression; readonly tag: string } | undefined {
  if (!ts.isBinaryExpression(node)) return undefined;
  if (
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    node.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken &&
    node.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken
  ) {
    return undefined;
  }

  const leftAccess = getTagAccess(node.left);
  const rightTag = getStringLiteral(node.right);
  if (leftAccess && rightTag) return { access: leftAccess, tag: rightTag };

  const rightAccess = getTagAccess(node.right);
  const leftTag = getStringLiteral(node.left);
  if (rightAccess && leftTag) return { access: rightAccess, tag: leftTag };

  return undefined;
}

function getTagAccess(node: ts.Expression): ts.PropertyAccessExpression | undefined {
  const expression = ts.skipParentheses(node);
  if (!ts.isPropertyAccessExpression(expression)) return undefined;
  return expression.name.text === "_tag" ? expression : undefined;
}

function getStringLiteral(node: ts.Expression): string | undefined {
  const expression = ts.skipParentheses(node);
  return ts.isStringLiteral(expression) ? expression.text : undefined;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

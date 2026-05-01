import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "..");
const testRegistrars = new Set(["describe", "it", "test"]);
const effectModules = new Set(["Option", "Either", "Result", "Cause", "Exit"]);
const tagModules = new Map([
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
const readOnlyMutations = new Set([
  "probeMcpEndpoint",
  "startMcpOAuth",
  "probeGoogleDiscovery",
  "startGoogleDiscoveryOAuth",
  "previewOpenApiSpec",
  "startOpenApiOAuth",
  "startOAuth",
  "resolveSecret",
  "detectSource",
  "getDomainVerificationLink",
]);

const packageRoots = collectPackageRoots().sort((a, b) => b.root.length - a.root.length);

const plugin = {
  meta: {
    name: "executor",
  },
  rules: {
    "no-vitest-import": {
      meta: {
        type: "problem",
        docs: {
          description: "Require test helpers to come from @effect/vitest.",
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "vitest") return;
            if (isConfigOrTooling(context.filename)) return;
            context.report({
              node: node.source,
              message:
                "Import test helpers from @effect/vitest or @effect/vitest/utils instead of vitest.",
            });
          },
        };
      },
    },
    "no-conditional-tests": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow conditional test registration.",
        },
      },
      create(context) {
        if (!isTestLike(context.filename)) return {};
        return {
          ConditionalExpression(node) {
            if (
              isTestRegistrarReference(node.consequent) ||
              isTestRegistrarReference(node.alternate)
            ) {
              context.report({
                node,
                message:
                  "Avoid conditional test registration; use explicit skip helpers or Effect Vitest helpers.",
              });
            }
          },
          IfStatement(node) {
            if (
              containsTestRegistrarCall(node.consequent) ||
              containsTestRegistrarCall(node.alternate)
            ) {
              context.report({
                node,
                message:
                  "Avoid conditional test registration; use explicit skip helpers or Effect Vitest helpers.",
              });
            }
          },
        };
      },
    },
    "no-double-cast": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow double casts through unknown or any.",
        },
      },
      create(context) {
        if (isConfigOrTooling(context.filename)) return {};
        return {
          TSAsExpression(node) {
            if (node.expression?.type !== "TSAsExpression") return;
            const innerType = node.expression.typeAnnotation?.type;
            if (innerType !== "TSUnknownKeyword" && innerType !== "TSAnyKeyword") return;
            if (hasDoubleCastAllowComment(context, node)) return;
            context.report({
              node,
              message:
                "Avoid double casts through unknown/any; use a typed boundary, schema decode, or a narrow allow comment with a reason.",
            });
          },
        };
      },
    },
    "no-cross-package-relative-imports": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow relative imports across workspace package boundaries.",
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            const specifier = node.source.value;
            if (typeof specifier !== "string" || !specifier.startsWith(".")) return;
            const target = getCrossPackageRelativeImport(context.filename, specifier);
            if (!target) return;
            context.report({
              node: node.source,
              message: `Import ${target.targetPackage} via its package export instead of a relative path.`,
            });
          },
        };
      },
    },
    "require-reactivity-keys": {
      meta: {
        type: "problem",
        docs: {
          description: "Require write mutation calls to pass reactivityKeys.",
        },
      },
      create(context) {
        return {
          Program(node) {
            if (isConfigOrTooling(context.filename) || isDeclarationFile(context.filename)) return;
            const text = context.sourceCode.getText();
            if (!text.includes("useAtomSet")) return;

            for (const violation of getReactivityKeyViolations(text)) {
              context.report({
                node,
                loc: { line: violation.line, column: 0 },
                message: `Mutation ${violation.mutationVar} must pass reactivityKeys at the call site.`,
              });
            }
          },
        };
      },
    },
    "no-effect-internal-tags": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow direct _tag checks for Effect-owned data types.",
        },
      },
      create(context) {
        const importedEffectModules = new Set();
        return {
          ImportDeclaration(node) {
            const moduleName = node.source.value;
            if (typeof moduleName !== "string") return;
            if (moduleName.startsWith("effect/")) {
              const submodule = moduleName.slice("effect/".length);
              if (effectModules.has(submodule)) importedEffectModules.add(submodule);
              return;
            }
            if (moduleName !== "effect") return;
            for (const specifier of node.specifiers ?? []) {
              const importedName = specifier.imported?.name ?? specifier.imported?.value;
              if (effectModules.has(importedName)) importedEffectModules.add(importedName);
            }
          },
          BinaryExpression(node) {
            if (importedEffectModules.size === 0) return;
            if (!isEqualityOperator(node.operator)) return;

            const leftAccess = getTagAccess(node.left);
            const rightTag = getStringLiteralValue(node.right);
            if (leftAccess && isEffectTagForImportedModule(rightTag, importedEffectModules)) {
              reportEffectTag(context, leftAccess, rightTag);
              return;
            }

            const rightAccess = getTagAccess(node.right);
            const leftTag = getStringLiteralValue(node.left);
            if (rightAccess && isEffectTagForImportedModule(leftTag, importedEffectModules)) {
              reportEffectTag(context, rightAccess, leftTag);
            }
          },
        };
      },
    },
  },
};

export default plugin;

function isConfigOrTooling(filename) {
  const normalized = toRepoRelative(filename);
  return (
    /(^|\/)(vite|vitest|tsup|drizzle|autumn)\.config\.ts$/.test(normalized) ||
    normalized.startsWith("scripts/")
  );
}

function isTestLike(filename) {
  const normalized = toRepoRelative(filename);
  return (
    /(\.|\/)(test|spec|e2e|node\.test)\.tsx?$/.test(normalized) || normalized.startsWith("tests/")
  );
}

function isDeclarationFile(filename) {
  return toRepoRelative(filename).endsWith(".d.ts");
}

function isTestRegistrarReference(node) {
  const expression = unwrapChain(node);
  if (!expression) return false;
  if (expression.type === "Identifier") return testRegistrars.has(expression.name);
  if (expression.type !== "MemberExpression") return false;
  const object = unwrapChain(expression.object);
  return object?.type === "Identifier" && testRegistrars.has(object.name);
}

function containsTestRegistrarCall(node) {
  if (!node) return false;
  let found = false;
  visit(node, (child) => {
    if (found || child.type !== "CallExpression") return;
    if (isTestRegistrarReference(child.callee)) found = true;
  });
  return found;
}

function hasDoubleCastAllowComment(context, node) {
  const comments = context.sourceCode.getCommentsBefore(node);
  const previous = comments.at(-1);
  const sameLineComment = comments.find((comment) => comment.loc.end.line === node.loc.start.line);
  return hasAllowReason(previous) || hasAllowReason(sameLineComment);
}

function hasAllowReason(comment) {
  if (!comment) return false;
  const marker = "lint-allow-double-cast:";
  const index = comment.value.indexOf(marker);
  return index >= 0 && comment.value.slice(index + marker.length).trim().length > 0;
}

function getReactivityKeyViolations(text) {
  const violations = [];
  const lines = text.split("\n");
  const useAtomSetRegex = /useAtomSet\(\s*([A-Za-z_][\w]*)\s*,\s*\{\s*mode:\s*"promise"\s*\}\s*\)/g;

  for (let cursor = 0; cursor < lines.length; cursor++) {
    const line = lines[cursor] ?? "";
    useAtomSetRegex.lastIndex = 0;
    const match = useAtomSetRegex.exec(line);
    if (!match) continue;

    const mutationVar = match[1] ?? "<unknown>";
    if (readOnlyMutations.has(mutationVar)) continue;

    const binding = line.match(/const\s+(\w+)\s*=\s*useAtomSet/)?.[1];
    if (!binding) continue;

    const callRegex = new RegExp(`await\\s+${binding}\\s*\\(`);
    let i = cursor + 1;
    while (i < lines.length) {
      const currentLine = lines[i] ?? "";
      if (callRegex.test(currentLine)) {
        const argText = extractCallArgs(lines, i);
        if (!argText.includes("reactivityKeys")) {
          violations.push({ line: i + 1, mutationVar });
        }
        break;
      }
      i++;
      if (i - cursor > 80) break;
    }
  }

  return violations;
}

function extractCallArgs(lines, startLine) {
  let depth = 0;
  let started = false;
  let argText = "";
  let current = startLine;

  while (current < lines.length) {
    for (const ch of lines[current] ?? "") {
      if (ch === "(") {
        depth++;
        started = true;
        continue;
      }
      if (started && ch === ")") {
        depth--;
        if (depth === 0) return argText;
      }
      if (started) argText += ch;
    }
    current++;
    if (current - startLine > 60) break;
  }

  return argText;
}

function isEqualityOperator(operator) {
  return operator === "===" || operator === "!==" || operator === "==" || operator === "!=";
}

function getTagAccess(node) {
  const expression = unwrapParentheses(node);
  if (expression?.type !== "MemberExpression") return undefined;
  const property = expression.property;
  const name = expression.computed ? getStringLiteralValue(property) : property?.name;
  return name === "_tag" ? expression : undefined;
}

function getStringLiteralValue(node) {
  const expression = unwrapParentheses(node);
  if (expression?.type === "Literal" && typeof expression.value === "string")
    return expression.value;
  if (expression?.type === "StringLiteral") return expression.value;
  return undefined;
}

function isEffectTagForImportedModule(tag, importedEffectModules) {
  if (!tag) return false;
  const modules = tagModules.get(tag);
  return modules?.some((moduleName) => importedEffectModules.has(moduleName)) ?? false;
}

function reportEffectTag(context, node, tag) {
  context.report({
    node,
    message: `Use Effect's public helpers instead of checking internal _tag "${tag}".`,
  });
}

function getCrossPackageRelativeImport(filename, specifier) {
  const absoluteFile = path.resolve(filename);
  const sourcePackage = findPackageRoot(absoluteFile);
  if (!sourcePackage) return undefined;

  const resolved = path.resolve(path.dirname(absoluteFile), specifier);
  const targetPackage = findPackageRoot(resolved);
  if (!targetPackage || targetPackage.root === sourcePackage.root) return undefined;

  return { targetPackage: targetPackage.name };
}

function findPackageRoot(absolutePath) {
  const normalized = path.normalize(absolutePath);
  return packageRoots.find(
    (pkg) => normalized === pkg.root || normalized.startsWith(`${pkg.root}${path.sep}`),
  );
}

function collectPackageRoots() {
  const roots = [];
  for (const root of ["packages", "apps", "examples"]) {
    collectPackageRootsFrom(path.join(repoRoot, root), roots);
  }
  return roots;
}

function collectPackageRootsFrom(dir, roots) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const packageRoot = path.join(dir, entry.name);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const json = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (typeof json.name === "string") roots.push({ root: packageRoot, name: json.name });
    } else {
      collectPackageRootsFrom(packageRoot, roots);
    }
  }
}

function toRepoRelative(filename) {
  return path.relative(repoRoot, path.resolve(filename)).split(path.sep).join("/");
}

function unwrapChain(node) {
  let current = node;
  while (current?.type === "ChainExpression") current = current.expression;
  return current;
}

function unwrapParentheses(node) {
  let current = unwrapChain(node);
  while (current?.type === "ParenthesizedExpression" || current?.type === "TSNonNullExpression") {
    current = unwrapChain(current.expression);
  }
  return current;
}

function visit(node, fn, seen = new WeakSet()) {
  if (!node || typeof node.type !== "string") return;
  if (seen.has(node)) return;
  seen.add(node);

  fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent" || key === "loc" || key === "range" || key === "span") continue;
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, fn, seen);
    } else if (typeof value.type === "string") {
      visit(value, fn, seen);
    }
  }
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "..");
const testRegistrars = new Set(["describe", "it", "test"]);

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

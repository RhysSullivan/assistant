import { getTypeScriptModule, unwrapExpression } from "./typechecker-ts-utils";

export interface ToolReferenceAnalysis {
  callPaths: string[];
  hasDynamicToolAccess: boolean;
  hasNonCallToolAccess: boolean;
}

type StaticToolPathResult = {
  segments: string[] | null;
  dynamic: boolean;
};

function parseStaticToolPath(
  expression: import("typescript").Expression,
  ts: typeof import("typescript"),
): StaticToolPathResult {
  const unwrapped = unwrapExpression(expression, ts);

  if (ts.isIdentifier(unwrapped)) {
    if (unwrapped.text === "tools") {
      return { segments: [], dynamic: false };
    }
    return { segments: null, dynamic: false };
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    const base = parseStaticToolPath(unwrapped.expression, ts);
    if (!base.segments) return base;
    return {
      segments: [...base.segments, unwrapped.name.text],
      dynamic: base.dynamic,
    };
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    const base = parseStaticToolPath(unwrapped.expression, ts);
    if (!base.segments) return base;

    const argument = unwrapped.argumentExpression
      ? unwrapExpression(unwrapped.argumentExpression, ts)
      : null;

    if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      return {
        segments: [...base.segments, argument.text],
        dynamic: base.dynamic,
      };
    }

    return {
      segments: base.segments,
      dynamic: true,
    };
  }

  return { segments: null, dynamic: false };
}

/**
 * Analyze user code and extract static tool call paths like
 * `tools.github.issues.list_for_repo(...)`.
 */
export function analyzeToolReferences(code: string): ToolReferenceAnalysis {
  const ts = getTypeScriptModule();
  if (!ts) {
    return {
      callPaths: [],
      hasDynamicToolAccess: true,
      hasNonCallToolAccess: true,
    };
  }

  const sourceFile = ts.createSourceFile(
    "generated_user_code.ts",
    code,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const callPaths = new Set<string>();
  let hasDynamicToolAccess = false;
  let hasNonCallToolAccess = false;

  const isInCallTargetChain = (node: import("typescript").Node): boolean => {
    let current = node;
    while (
      (ts.isPropertyAccessExpression(current.parent) || ts.isElementAccessExpression(current.parent))
      && current.parent.expression === current
    ) {
      current = current.parent;
    }
    return ts.isCallExpression(current.parent) && current.parent.expression === current;
  };

  const visit = (node: import("typescript").Node): void => {
    if (ts.isCallExpression(node)) {
      const parsed = parseStaticToolPath(node.expression, ts);
      if (parsed.segments && parsed.segments.length > 0 && !parsed.dynamic) {
        callPaths.add(parsed.segments.join("."));
      }
      if (parsed.dynamic) {
        hasDynamicToolAccess = true;
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const parsed = parseStaticToolPath(node, ts);
      if (parsed.segments) {
        if (!isInCallTargetChain(node)) {
          hasNonCallToolAccess = true;
        }
        if (parsed.dynamic) {
          hasDynamicToolAccess = true;
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    callPaths: [...callPaths].sort((a, b) => a.localeCompare(b)),
    hasDynamicToolAccess,
    hasNonCallToolAccess,
  };
}

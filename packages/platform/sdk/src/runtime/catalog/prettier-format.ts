import {
  format,
} from "prettier/standalone";
import parserBabel from "prettier/plugins/babel";
import parserEstree from "prettier/plugins/estree";
import parserTypescript from "prettier/plugins/typescript";

export type PrettierParser = "json" | "typescript" | "typescript-module";

const plugins = [parserBabel, parserEstree, parserTypescript];

const formatCache = new Map<string, string>();

function formatCacheKey(code: string, parser: PrettierParser): string {
  return `${parser}::${code.length}::${code}`;
}

export async function formatWithPrettier(
  code: string,
  parser: PrettierParser,
): Promise<string> {
  const key = formatCacheKey(code, parser);
  const cached = formatCache.get(key);
  if (cached) return cached;

  try {
    let input = code;
    let unwrap = false;

    if (parser === "typescript") {
      input = `type __T = ${code}`;
      unwrap = true;
    }

    const result = await format(input, {
      parser: parser === "typescript-module" ? "typescript" : parser,
      plugins,
      printWidth: 60,
      tabWidth: 2,
      semi: true,
      singleQuote: false,
      trailingComma: "all",
    });

    let trimmed = result.trimEnd();

    if (unwrap) {
      trimmed = trimmed
        .replace(/^type __T =\s*/, "")
        .replace(/;$/, "")
        .trimEnd();
    }

    formatCache.set(key, trimmed);
    return trimmed;
  } catch {
    return code;
  }
}

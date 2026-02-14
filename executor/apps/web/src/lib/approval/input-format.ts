export type FormattedApprovalInput = {
  content: string;
  language: "json" | "text";
};

export type FormatApprovalInputOptions = {
  hideSerializedNull?: boolean;
  hideSerializedEmptyObject?: boolean;
};

function shouldHideSerialized(
  serialized: string,
  options: FormatApprovalInputOptions,
): boolean {
  if (options.hideSerializedNull && serialized === "null") {
    return true;
  }

  if (options.hideSerializedEmptyObject && serialized === "{}") {
    return true;
  }

  return false;
}

export function formatApprovalInput(
  input: unknown,
  options: FormatApprovalInputOptions = {},
): FormattedApprovalInput | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const serialized = JSON.stringify(JSON.parse(trimmed), null, 2);
      if (shouldHideSerialized(serialized, options)) {
        return null;
      }

      return {
        content: serialized,
        language: "json",
      };
    } catch {
      return {
        content: trimmed,
        language: "text",
      };
    }
  }

  try {
    const serialized = JSON.stringify(input, null, 2);
    if (shouldHideSerialized(serialized, options)) {
      return null;
    }

    return {
      content: serialized,
      language: "json",
    };
  } catch {
    const fallback = String(input).trim();
    if (!fallback) {
      return null;
    }

    return {
      content: fallback,
      language: "text",
    };
  }
}

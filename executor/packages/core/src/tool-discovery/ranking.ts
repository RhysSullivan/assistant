import { getTopLevelNamespace, normalizeSearchToken } from "./indexing";
import type { DiscoverIndexEntry, RankedIndexEntry } from "./types";

const DISCOVER_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function extractNamespaceHints(terms: string[], namespaces: Set<string>): Set<string> {
  const hints = new Set<string>();

  for (const term of terms) {
    const direct = term.toLowerCase();
    if (namespaces.has(direct)) {
      hints.add(direct);
      continue;
    }

    const leadingSegment = direct.split(".")[0] ?? direct;
    if (namespaces.has(leadingSegment)) {
      hints.add(leadingSegment);
    }
  }

  return hints;
}

export function deriveIntentPhrase(terms: string[], namespaceHints: Set<string>): string {
  const important = terms
    .map((term) => term.toLowerCase())
    .filter((term) => !namespaceHints.has(term))
    .filter((term) => !DISCOVER_STOP_WORDS.has(term))
    .filter((term) => term.length > 2);

  return normalizeSearchToken(important.join(" "));
}

export function chooseBestPath(ranked: RankedIndexEntry[], termCount: number): string | null {
  if (ranked.length === 0) return null;

  const best = ranked[0];
  if (!best) return null;

  const minScore = termCount === 0 ? 1 : Math.max(3, termCount * 2 - 1);
  if (best.score < minScore) {
    return null;
  }

  const second = ranked[1];
  if (second && best.score - second.score < 2) {
    return null;
  }

  return best.entry.preferredPath;
}

export function scoreEntry(
  entry: DiscoverIndexEntry,
  terms: string[],
  namespaceHints: Set<string>,
  intentPhrase: string,
): number {
  let score = 0;
  let matched = 0;

  if (namespaceHints.size > 0) {
    const namespace = getTopLevelNamespace(entry.path);
    if (namespaceHints.has(namespace)) {
      score += 6;
    } else {
      score -= 8;
    }
  }

  for (const term of terms) {
    const normalizedTerm = normalizeSearchToken(term);
    const inPath = entry.path.toLowerCase().includes(term);
    const inNormalizedPath = normalizedTerm.length > 0 && entry.normalizedPath.includes(normalizedTerm);
    const inText = entry.searchText.includes(term);
    const inNormalizedText = normalizedTerm.length > 0 && entry.normalizedSearchText.includes(normalizedTerm);
    if (!inPath && !inText && !inNormalizedPath && !inNormalizedText) continue;
    matched += 1;
    score += 1;
    if (inPath || inNormalizedPath) score += 2;
  }

  if (intentPhrase.length >= 6) {
    if (entry.normalizedPath.includes(intentPhrase)) {
      score += 6;
    } else if (entry.normalizedSearchText.includes(intentPhrase)) {
      score += 3;
    }
  }

  if (terms.length > 0 && matched < Math.max(1, Math.ceil(terms.length / 2))) {
    return -1;
  }

  return score + matched * 2;
}

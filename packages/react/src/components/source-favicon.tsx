import { BoxIcon } from "lucide-react";
import { useState } from "react";
import { getDomain } from "tldts";

// ---------------------------------------------------------------------------
// SourceFavicon — renders a small favicon derived from a source URL.
// Falls back to a neutral dot if the URL is missing or the image fails to load.
// ---------------------------------------------------------------------------

function domainOf(url: string): string | null {
  try {
    return getDomain(url) ?? getDomain(new URL(url).hostname) ?? null;
  } catch {
    return null;
  }
}

export function SourceFavicon({ url, size = 16 }: { url?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const domain = url ? domainOf(url) : null;

  if (!domain || failed) {
    return (
      <BoxIcon
        aria-hidden
        className="shrink-0 text-muted-foreground"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=${size * 2}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-sm"
      style={{ width: size, height: size }}
    />
  );
}

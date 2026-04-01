import { Link, useLocation } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAtomValue, toolsAtom, Result } from "@executor/react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Nav item
// ---------------------------------------------------------------------------

function NavItem(props: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={props.to}
      className={[
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
        props.active
          ? "bg-sidebar-active text-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
      ].join(" ")}
    >
      {props.label}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Source list in sidebar
// ---------------------------------------------------------------------------

function SourceList() {
  const tools = useAtomValue(toolsAtom());
  const { pathname } = useLocation();

  const sources = useMemo(() => {
    if (tools._tag !== "Success") return [];
    const namespaces = new Map<string, number>();
    for (const tool of tools.value) {
      if (!tool.tags.includes("openapi")) continue;
      const ns = tool.tags[tool.tags.length - 1];
      if (ns && ns !== "openapi") {
        namespaces.set(ns, (namespaces.get(ns) ?? 0) + 1);
      }
    }
    return [...namespaces.entries()].map(([ns, count]) => ({ namespace: ns, toolCount: count }));
  }, [tools]);

  if (tools._tag === "Initial" || tools.waiting) {
    return <div className="px-2.5 py-2 text-[11px] text-muted-foreground/40">Loading…</div>;
  }

  if (sources.length === 0) {
    return <div className="px-2.5 py-2 text-[11px] text-muted-foreground/40">No sources yet</div>;
  }

  return (
    <div className="flex flex-col gap-px">
      {sources.map((s) => {
        const detailPath = `/sources/${s.namespace}`;
        const active = pathname === detailPath || pathname.startsWith(`${detailPath}/`);
        return (
          <Link
            key={s.namespace}
            to="/sources/$namespace"
            params={{ namespace: s.namespace }}
            className={[
              "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
              active
                ? "bg-sidebar-active text-foreground font-medium"
                : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="flex-1 truncate">{s.namespace}</span>
            <span className="text-[10px] tabular-nums text-muted-foreground/50">{s.toolCount}</span>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden w-52 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col lg:w-56">
        {/* Brand */}
        <div className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-4">
          <Link to="/" className="flex items-center gap-1.5">
            <span className="font-display text-base tracking-tight text-foreground">
              executor
            </span>
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              v4
            </span>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col overflow-y-auto p-2">
          <NavItem to="/" label="Tools" active={pathname === "/" || pathname === "/tools"} />
          <NavItem to="/secrets" label="Secrets" active={pathname === "/secrets"} />

          {/* Sources section */}
          <div className="mt-5 mb-1 px-2.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
            <div className="flex items-center justify-between gap-2">
              <span>Sources</span>
              <Link
                to="/sources"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium normal-case tracking-normal text-primary transition-colors hover:bg-sidebar-active hover:text-foreground"
              >
                <svg viewBox="0 0 16 16" fill="none" className="size-3">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Add
              </Link>
            </div>
          </div>

          <SourceList />
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-sidebar-border px-4 py-2.5">
          <div className="flex items-center justify-between text-[10px] leading-none">
            <span className="text-muted-foreground/70 tabular-nums">v4.0.0-dev</span>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground/70 transition-colors hover:text-foreground"
            >
              GitHub
            </a>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex min-h-0 flex-1 flex-col min-w-0 overflow-auto">
        <div className="flex-1 p-6 max-w-5xl">
          {children}
        </div>
      </main>
    </div>
  );
}

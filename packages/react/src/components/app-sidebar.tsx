import { Result } from "@effect-atom/atom-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSourcesWithPending } from "../api/optimistic";
import { useScope } from "../api/scope-context";
import { Button } from "./button";
import { Skeleton } from "./skeleton";
import { SourceFavicon } from "./source-favicon";

export function NavItem(props: { to: string; label: string; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      to={props.to}
      onClick={props.onNavigate}
      className={[
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        props.active
          ? "bg-sidebar-active text-foreground font-medium"
          : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
      ].join(" ")}
    >
      {props.label}
    </Link>
  );
}

export function AppShellFrame(props: {
  pathname: string;
  commandPalette: ReactNode;
  children: ReactNode;
  sidebar: (props: { onNavigate?: () => void; showBrand?: boolean }) => ReactNode;
}) {
  const lastPathname = useRef(props.pathname);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  if (lastPathname.current !== props.pathname) {
    lastPathname.current = props.pathname;
    if (mobileSidebarOpen) setMobileSidebarOpen(false);
  }

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileSidebarOpen]);

  return (
    <div className="flex h-screen overflow-hidden">
      {props.commandPalette}
      <aside className="hidden w-52 shrink-0 border-r border-sidebar-border bg-sidebar md:flex md:flex-col lg:w-56">
        {props.sidebar({})}
      </aside>

      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* oxlint-disable-next-line react/forbid-elements */}
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative flex h-full w-[84vw] max-w-xs flex-col border-r border-sidebar-border bg-sidebar shadow-2xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
              <BrandLink />
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                aria-label="Close navigation"
                onClick={() => setMobileSidebarOpen(false)}
                className="text-sidebar-foreground hover:bg-sidebar-active hover:text-foreground"
              >
                <svg viewBox="0 0 16 16" className="size-3.5">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </Button>
            </div>
            {props.sidebar({
              onNavigate: () => setMobileSidebarOpen(false),
              showBrand: false,
            })}
          </div>
        </div>
      )}

      <main className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-4 md:hidden">
          <Button
            variant="outline"
            size="icon-sm"
            type="button"
            aria-label="Open navigation"
            onClick={() => setMobileSidebarOpen(true)}
            className="bg-card hover:bg-accent/50"
          >
            <svg viewBox="0 0 16 16" className="size-4">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </Button>
          <BrandLink />
          <div className="w-8 shrink-0" />
        </div>
        {props.children}
      </main>
    </div>
  );
}

export function BrandLink() {
  return (
    <Link to="/" className="flex items-center gap-1.5">
      <span className="font-display text-base tracking-tight text-foreground">executor</span>
    </Link>
  );
}

export function SourceList(props: {
  pathname: string;
  onNavigate?: () => void;
  loading?: "text" | "skeleton";
}) {
  const scopeId = useScope();
  const sources = useSourcesWithPending(scopeId);

  return Result.match(sources, {
    onInitial: () =>
      props.loading === "skeleton" ? (
        <div className="flex flex-col gap-1 px-2.5 py-1">
          {[80, 65, 72, 58, 68].map((w, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md py-1.5">
              <Skeleton className="size-3.5 shrink-0 rounded" />
              <Skeleton className="h-3" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-2 text-xs text-muted-foreground">Loading…</div>
      ),
    onFailure: () => (
      <div className="px-2.5 py-2 text-xs text-muted-foreground">No sources yet</div>
    ),
    onSuccess: ({ value }) =>
      value.length === 0 ? (
        <div className="px-2.5 py-2 text-sm leading-relaxed text-muted-foreground">
          No sources yet
        </div>
      ) : (
        <div className="flex flex-col gap-px">
          {value.map((s) => {
            const detailPath = `/sources/${s.id}`;
            const active =
              props.pathname === detailPath || props.pathname.startsWith(`${detailPath}/`);
            return (
              <Link
                key={s.id}
                to="/sources/$namespace"
                params={{ namespace: s.id }}
                onClick={props.onNavigate}
                className={[
                  "group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                  active
                    ? "bg-sidebar-active text-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-foreground",
                ].join(" ")}
              >
                <SourceFavicon url={s.url} />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="rounded bg-secondary/50 px-1 py-px text-xs font-medium text-muted-foreground">
                  {s.kind}
                </span>
              </Link>
            );
          })}
        </div>
      ),
  });
}

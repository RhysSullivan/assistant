import * as React from "react";
import {
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import { ExecutorReactProvider } from "@executor-v3/react";

import "./globals.css";

import { AppShell } from "./components/shell";
import { HomePage } from "./views/home";
import { EditSourcePage, NewSourcePage } from "./views/source-editor";
import { SourceDetailPage } from "./views/source-detail";
import { SecretsPage } from "./views/secrets";

// ---------------------------------------------------------------------------
// Route search schema
// ---------------------------------------------------------------------------

type SourceRouteSearch = {
  tab: "model" | "discover" | "manifest" | "definitions" | "raw";
  tool?: string;
  query?: string;
};

const sourceTabs = ["model", "discover", "manifest", "definitions", "raw"] as const;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute({
  component: AppShell,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const newSourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources/new",
  component: NewSourcePage,
});

const sourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources/$sourceId",
  validateSearch: (search: Record<string, unknown>): SourceRouteSearch => ({
    tab:
      typeof search.tab === "string" && sourceTabs.includes(search.tab as SourceRouteSearch["tab"])
        ? (search.tab as SourceRouteSearch["tab"])
        : "model",
    tool: typeof search.tool === "string" && search.tool.length > 0 ? search.tool : undefined,
    query: typeof search.query === "string" ? search.query : undefined,
  }),
  component: SourceDetailPageWrapper,
});

const editSourceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sources/$sourceId/edit",
  component: EditSourcePageWrapper,
});

const secretsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/secrets",
  component: SecretsPage,
});


function SourceDetailPageWrapper() {
  const { sourceId } = sourceRoute.useParams();
  const search = sourceRoute.useSearch();
  const navigate = useNavigate({ from: sourceRoute.fullPath });

  return (
    <SourceDetailPage
      sourceId={sourceId}
      search={search}
      navigate={navigate as any}
    />
  );
}

function EditSourcePageWrapper() {
  const { sourceId } = editSourceRoute.useParams();
  return <EditSourcePage sourceId={sourceId} />;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routeTree = rootRoute.addChildren([homeRoute, newSourceRoute, sourceRoute, editSourceRoute, secretsRoute]);

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  return (
    <React.StrictMode>
      <ExecutorReactProvider>
        <RouterProvider router={router} />
      </ExecutorReactProvider>
    </React.StrictMode>
  );
}

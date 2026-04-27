import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "@executor/react/pages/sources";
import { sourcePlugins } from "../web/source-plugins";


export const Route = createFileRoute("/")({
  component: () => <SourcesPage sourcePlugins={sourcePlugins} />,
});

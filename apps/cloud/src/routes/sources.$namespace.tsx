import { createFileRoute } from "@tanstack/react-router";
import { SourceDetailPage } from "@executor/react/pages/source-detail";
import { sourcePlugins } from "../web/source-plugins";


export const Route = createFileRoute("/sources/$namespace")({
  component: () => {
    const { namespace } = Route.useParams();
    return <SourceDetailPage namespace={namespace} sourcePlugins={sourcePlugins} />;
  },
});

import { useEffect, useMemo, useState } from "react";
import { CodeBlock } from "./code-block";

export function LocalMcpInstallCard(props: {
  title?: string;
  description?: string;
  className?: string;
}) {
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const command = useMemo(
    () =>
      origin
        ? `npx add-mcp "${origin}/mcp" --transport http --name "executor"`
        : 'npx add-mcp "<this-server>/mcp" --transport http --name "executor"',
    [origin],
  );

  return (
    <section className={props.className ?? "rounded-2xl border border-border bg-card/80 p-5"}>
      <div className="mb-3 space-y-1">
        <h2 className="text-sm font-semibold text-foreground">
          {props.title ?? "Install local MCP"}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {props.description
            ?? "Add this local executor server to an MCP client with one command. The URL uses the same origin as this web app."}
        </p>
      </div>
      <CodeBlock code={command} lang="bash" className="rounded-xl border border-border bg-background/70" />
    </section>
  );
}

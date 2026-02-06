import { Context, Data, Effect, Layer } from "effect";

const DEFAULT_BASE_URL = "https://api.github.com";

export class GitHubClientError extends Data.TaggedError("GitHubClientError")<{
  cause: unknown;
}> {}

export class GitHubClientConfigError extends Data.TaggedError("GitHubClientConfigError")<{
  message: string;
}> {}

export type GitHubIssueSummary = {
  number: number;
  title: string;
  state: string;
  createdAt: string;
  htmlUrl: string;
};

export type IGitHubClient = Readonly<{
  use: <A>(
    fn: (client: {
      listOpenIssues: (params: {
        owner: string;
        repo: string;
        perPage?: number;
        page?: number;
      }) => Promise<Array<GitHubIssueSummary>>;
      closeIssue: (params: {
        owner: string;
        repo: string;
        issueNumber: number;
        reason?: "completed" | "not_planned" | "reopened";
      }) => Promise<GitHubIssueSummary>;
    }) => Promise<A>,
  ) => Effect.Effect<A, GitHubClientError | GitHubClientConfigError, never>;
}>;

const makeGitHubClient = Effect.gen(function* () {
  const token = readEnv("OPENASSISTANT_GITHUB_TOKEN") ?? readEnv("GITHUB_TOKEN");
  if (!token) {
    return yield* Effect.fail(
      new GitHubClientConfigError({
        message: "Missing GitHub token. Set OPENASSISTANT_GITHUB_TOKEN (or GITHUB_TOKEN).",
      }),
    );
  }

  const baseUrl = readEnv("OPENASSISTANT_GITHUB_BASE_URL") ?? DEFAULT_BASE_URL;

  const request = <T>(params: {
    method: "GET" | "PATCH";
    path: string;
    body?: unknown;
  }): Promise<T> =>
    fetch(`${baseUrl}${params.path}`, {
      method: params.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(params.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(params.body ? { body: JSON.stringify(params.body) } : {}),
    }).then(async (response) => {
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`GitHub API ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
      }
      return (await response.json()) as T;
    });

  const listOpenIssues = async (params: {
    owner: string;
    repo: string;
    perPage?: number;
    page?: number;
  }): Promise<Array<GitHubIssueSummary>> => {
    const perPage = Math.min(Math.max(params.perPage ?? 100, 1), 100);
    const page = Math.max(params.page ?? 1, 1);
    const issues = await request<
      Array<{
        number: number;
        title: string;
        state: string;
        created_at: string;
        html_url: string;
        pull_request?: unknown;
      }>
    >({
      method: "GET",
      path: `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues?state=open&per_page=${perPage}&page=${page}&sort=created&direction=asc`,
    });

    return issues
      .filter((issue) => issue.pull_request === undefined)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        createdAt: issue.created_at,
        htmlUrl: issue.html_url,
      }));
  };

  const closeIssue = async (params: {
    owner: string;
    repo: string;
    issueNumber: number;
    reason?: "completed" | "not_planned" | "reopened";
  }): Promise<GitHubIssueSummary> => {
    const issue = await request<{
      number: number;
      title: string;
      state: string;
      created_at: string;
      html_url: string;
    }>({
      method: "PATCH",
      path: `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/${params.issueNumber}`,
      body: {
        state: "closed",
        ...(params.reason ? { state_reason: params.reason } : {}),
      },
    });

    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      createdAt: issue.created_at,
      htmlUrl: issue.html_url,
    };
  };

  const client = {
    listOpenIssues,
    closeIssue,
  };

  const use: IGitHubClient["use"] = (fn) =>
    Effect.tryPromise({
      try: () => fn(client),
      catch: (cause) => new GitHubClientError({ cause }),
    }).pipe(Effect.withSpan(`github.${fn.name ?? "use"}`));

  return {
    use,
  } as const;
});

export class GitHubClient extends Context.Tag("GitHubClient")<GitHubClient, IGitHubClient>() {
  static Default = Layer.effect(this, makeGitHubClient).pipe(
    Layer.annotateSpans({ module: "GitHubClient" }),
  );
}

function readEnv(key: string): string | undefined {
  const bun = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun;
  return bun?.env?.[key] ?? process.env[key];
}

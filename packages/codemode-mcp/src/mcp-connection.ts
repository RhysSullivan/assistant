import { URL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { McpConnection, McpConnector } from "./mcp-tools";

export type McpTransportPreference = "auto" | "streamable-http" | "sse";

export type CreateSdkMcpConnectorInput = {
  endpoint: string;
  transport?: McpTransportPreference;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  clientName?: string;
  clientVersion?: string;
};

const createEndpoint = (
  endpoint: string,
  queryParams: Record<string, string>,
): URL => {
  const url = new URL(endpoint);

  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(key, value);
  }

  return url;
};

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

const mergeHeadersForFetch = (
  input: FetchInput,
  init: FetchInit,
  headers: Record<string, string>,
): Promise<Response> => {
  const mergedHeaders = new Headers(init?.headers ?? {});

  for (const [key, value] of Object.entries(headers)) {
    mergedHeaders.set(key, value);
  }

  return fetch(input, {
    ...init,
    headers: mergedHeaders,
  });
};

const connectionFromClient = (client: Client): McpConnection => ({
  client,
  close: () => client.close(),
});

export const createSdkMcpConnector = (
  input: CreateSdkMcpConnectorInput,
): McpConnector => {
  const endpoint = createEndpoint(input.endpoint, input.queryParams ?? {});
  const headers = input.headers ?? {};
  const transport = input.transport ?? "auto";
  const requestInit = Object.keys(headers).length > 0
    ? { headers }
    : undefined;

  const createClient = () =>
    new Client(
      {
        name: input.clientName ?? "executor-v3-codemode-mcp",
        version: input.clientVersion ?? "0.1.0",
      },
      { capabilities: { elicitation: { form: {}, url: {} } } },
    );

  return async () => {
    const client = createClient();

    if (transport === "streamable-http") {
      await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit }));
      return connectionFromClient(client);
    }

    if (transport === "sse") {
      await client.connect(new SSEClientTransport(endpoint, {
        requestInit,
        eventSourceInit: requestInit
          ? {
              fetch: (requestInput: FetchInput, requestOptions: FetchInit) =>
                mergeHeadersForFetch(requestInput, requestOptions, headers),
            }
          : undefined,
      }));
      return connectionFromClient(client);
    }

    try {
      await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit }));
      return connectionFromClient(client);
    } catch {
      await client.connect(new SSEClientTransport(endpoint, {
        requestInit,
        eventSourceInit: requestInit
          ? {
              fetch: (requestInput: FetchInput, requestOptions: FetchInit) =>
                mergeHeadersForFetch(requestInput, requestOptions, headers),
            }
          : undefined,
      }));
      return connectionFromClient(client);
    }
  };
};

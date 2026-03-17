import * as Effect from "effect/Effect";

import {
  fallbackSourceDiscoveryResult,
  looksLikeGraphqlEndpoint,
  normalizeSourceDiscoveryUrl,
  probeHeadersFromAuth,
  type SourceProbeAuth,
  type SourceDiscoveryResult,
} from "@executor/source-core";
import { detectGoogleDiscoverySource } from "@executor/source-google-discovery";
import { detectGraphqlSource } from "@executor/source-graphql";
import { detectMcpSource } from "@executor/source-mcp";
import { detectOpenApiSource } from "@executor/source-openapi";

export const discoverSource = (input: {
  url: string;
  probeAuth?: SourceProbeAuth | null;
}): Effect.Effect<SourceDiscoveryResult, Error, never> =>
  Effect.gen(function* () {
    const normalizedUrl = normalizeSourceDiscoveryUrl(input.url);
    const headers = probeHeadersFromAuth(input.probeAuth);

    if (looksLikeGraphqlEndpoint(normalizedUrl)) {
      const graphql = yield* detectGraphqlSource({
        normalizedUrl,
        headers,
      });
      if (graphql) {
        return graphql;
      }

      const mcp = yield* detectMcpSource({
        normalizedUrl,
        headers,
      });
      if (mcp) {
        return mcp;
      }

      return fallbackSourceDiscoveryResult(normalizedUrl);
    }

    const googleDiscovery = yield* detectGoogleDiscoverySource({
      normalizedUrl,
      headers,
    });
    if (googleDiscovery) {
      return googleDiscovery;
    }

    const openApi = yield* detectOpenApiSource({
      normalizedUrl,
      headers,
    });
    if (openApi) {
      return openApi;
    }

    const graphql = yield* detectGraphqlSource({
      normalizedUrl,
      headers,
    });
    if (graphql) {
      return graphql;
    }

    const mcp = yield* detectMcpSource({
      normalizedUrl,
      headers,
    });
    if (mcp) {
      return mcp;
    }

    return fallbackSourceDiscoveryResult(normalizedUrl);
  });

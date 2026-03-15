import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import * as Layer from "effect/Layer";

import {
  EXECUTOR_TRACE_ENABLED_ENV,
  EXECUTOR_TRACE_OTLP_ENDPOINT_ENV,
  EXECUTOR_TRACE_OTLP_HTTP_ENDPOINT_ENV,
  EXECUTOR_TRACE_QUERY_BASE_URL_ENV,
  EXECUTOR_TRACE_SERVICE_NAME_ENV,
} from "./config";

const DEFAULT_TRACE_OTLP_ENDPOINT = "http://127.0.0.1:4317";
const DEFAULT_TRACE_QUERY_BASE_URL = "http://127.0.0.1:16686";
const DEFAULT_TRACE_SERVICE_NAME = "executor-local";

export type LocalTracingRuntime = {
  readonly layer: Layer.Layer<never>;
  readonly otlpEndpoint: string;
  readonly queryBaseUrl: string;
  readonly serviceName: string;
};

const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const envFlag = (value: string | undefined): boolean => {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const createLocalTracingRuntimeFromEnv = (): LocalTracingRuntime | null => {
  if (!envFlag(process.env[EXECUTOR_TRACE_ENABLED_ENV])) {
    return null;
  }

  const otlpEndpoint =
    trim(process.env[EXECUTOR_TRACE_OTLP_ENDPOINT_ENV])
    ?? trim(process.env[EXECUTOR_TRACE_OTLP_HTTP_ENDPOINT_ENV])
    ?? DEFAULT_TRACE_OTLP_ENDPOINT;
  const serviceName = trim(process.env[EXECUTOR_TRACE_SERVICE_NAME_ENV]) ?? DEFAULT_TRACE_SERVICE_NAME;
  const queryBaseUrl = trim(process.env[EXECUTOR_TRACE_QUERY_BASE_URL_ENV]) ?? DEFAULT_TRACE_QUERY_BASE_URL;

  return {
    layer: NodeSdk.layer(() => ({
      resource: {
        serviceName,
        attributes: {
          "service.namespace": "executor",
        },
      },
      spanProcessor: [new SimpleSpanProcessor(new OTLPTraceExporter({ url: otlpEndpoint }))],
    })),
    otlpEndpoint,
    queryBaseUrl,
    serviceName,
  };
};

export const tracingSearchUrl = (input: {
  queryBaseUrl: string;
  serviceName: string;
}): string => `${input.queryBaseUrl.replace(/\/$/, "")}/search?service=${encodeURIComponent(input.serviceName)}`;

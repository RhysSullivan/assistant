import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";

export type BrowserSourceNetworkLog = {
  id: string;
  method: string;
  url: string;
  resourceType: string | null;
  initiator: string | null;
  status: number | null;
  mimeType: string | null;
  startedAt: number;
  durationMs: number | null;
  encodedDataLength: number | null;
  failedText: string | null;
};

export type BrowserSourceSessionStatus = {
  active: boolean;
  url: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  pageTitle: string | null;
  pageUrl: string | null;
  launchMode: "headful" | "headless";
  note: string | null;
  logs: ReadonlyArray<BrowserSourceNetworkLog>;
};

const DEFAULT_CHROME_PATHS = [
  process.env.CHROME_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value && value.trim().length > 0));

const resolveChromeExecutablePath = (): string => {
  const found = DEFAULT_CHROME_PATHS.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "Could not find a Chrome/Chromium executable. Set CHROME_EXECUTABLE_PATH to continue.",
    );
  }
  return found;
};

class BrowserSourceCaptureController {
  private readonly logs: Array<BrowserSourceNetworkLog> = [];
  private readonly logIndexesByRequestId = new Map<string, number>();

  constructor(
    private readonly inputUrl: string,
    private readonly startedAtMs: number,
    private readonly launchMode: "headful" | "headless",
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
  ) {}

  static async start(url: string): Promise<BrowserSourceCaptureController> {
    const launchMode: "headful" | "headless" = process.env.DISPLAY ? "headful" : "headless";
    const browser = await chromium.launch({
      executablePath: resolveChromeExecutablePath(),
      headless: launchMode === "headless",
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const controller = new BrowserSourceCaptureController(
      url,
      Date.now(),
      launchMode,
      browser,
      context,
      page,
      cdp,
    );

    await controller.initialize();
    return controller;
  }

  private async initialize(): Promise<void> {
    this.cdp.on("Network.requestWillBeSent", (params: any) => {
      const requestId = typeof params.requestId === "string" ? params.requestId : null;
      if (!requestId) {
        return;
      }

      const log: BrowserSourceNetworkLog = {
        id: requestId,
        method: params.request?.method ?? "GET",
        url: params.request?.url ?? "",
        resourceType: typeof params.type === "string" ? params.type : null,
        initiator: typeof params.initiator?.type === "string" ? params.initiator.type : null,
        status: null,
        mimeType: null,
        startedAt: Date.now(),
        durationMs: null,
        encodedDataLength: null,
        failedText: null,
      };

      this.logIndexesByRequestId.set(requestId, this.logs.length);
      this.logs.push(log);
    });

    this.cdp.on("Network.responseReceived", (params: any) => {
      const requestId = typeof params.requestId === "string" ? params.requestId : null;
      if (!requestId) {
        return;
      }

      const index = this.logIndexesByRequestId.get(requestId);
      if (index === undefined) {
        return;
      }

      const current = this.logs[index];
      if (!current) {
        return;
      }

      current.status = typeof params.response?.status === "number" ? params.response.status : null;
      current.mimeType = typeof params.response?.mimeType === "string"
        ? params.response.mimeType
        : null;
    });

    this.cdp.on("Network.loadingFinished", (params: any) => {
      const requestId = typeof params.requestId === "string" ? params.requestId : null;
      if (!requestId) {
        return;
      }

      const index = this.logIndexesByRequestId.get(requestId);
      if (index === undefined) {
        return;
      }

      const current = this.logs[index];
      if (!current) {
        return;
      }

      current.durationMs = Math.max(0, Date.now() - current.startedAt);
      current.encodedDataLength =
        typeof params.encodedDataLength === "number" ? params.encodedDataLength : null;
    });

    this.cdp.on("Network.loadingFailed", (params: any) => {
      const requestId = typeof params.requestId === "string" ? params.requestId : null;
      if (!requestId) {
        return;
      }

      const index = this.logIndexesByRequestId.get(requestId);
      if (index === undefined) {
        return;
      }

      const current = this.logs[index];
      if (!current) {
        return;
      }

      current.durationMs = Math.max(0, Date.now() - current.startedAt);
      current.failedText = typeof params.errorText === "string" ? params.errorText : "Request failed";
    });

    await this.cdp.send("Page.enable");
    await this.cdp.send("Network.enable");
    await this.page.goto(this.inputUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.page.bringToFront();
  }

  async status(): Promise<BrowserSourceSessionStatus> {
    return {
      active: this.browser.isConnected(),
      url: this.inputUrl,
      startedAt: this.startedAtMs,
      stoppedAt: null,
      pageTitle: await this.page.title().catch(() => null),
      pageUrl: this.page.url(),
      launchMode: this.launchMode,
      note: this.launchMode === "headless"
        ? "No DISPLAY was available, so capture is running headless on the server."
        : null,
      logs: [...this.logs].slice(-200).reverse(),
    };
  }

  async stop(): Promise<BrowserSourceSessionStatus> {
    const pageTitle = await this.page.title().catch(() => null);
    const pageUrl = this.page.url();
    const stoppedAt = Date.now();

    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);

    return {
      active: false,
      url: this.inputUrl,
      startedAt: this.startedAtMs,
      stoppedAt,
      pageTitle,
      pageUrl,
      launchMode: this.launchMode,
      note: this.launchMode === "headless"
        ? "Capture ran headless because no DISPLAY was available."
        : null,
      logs: [...this.logs].slice(-200).reverse(),
    };
  }
}

type BrowserSourceRuntimeState = {
  controller: BrowserSourceCaptureController | null;
  lastStatus: BrowserSourceSessionStatus;
};

const globalState = globalThis as typeof globalThis & {
  __executorBrowserSourceRuntime__?: BrowserSourceRuntimeState;
};

const runtimeState = globalState.__executorBrowserSourceRuntime__ ?? {
  controller: null,
  lastStatus: {
    active: false,
    url: null,
    startedAt: null,
    stoppedAt: null,
    pageTitle: null,
    pageUrl: null,
    launchMode: "headless",
    note: null,
    logs: [],
  },
};

globalState.__executorBrowserSourceRuntime__ = runtimeState;

export const getBrowserSourceSessionStatus = async (): Promise<BrowserSourceSessionStatus> => {
  if (!runtimeState.controller) {
    return runtimeState.lastStatus;
  }

  runtimeState.lastStatus = await runtimeState.controller.status();
  return runtimeState.lastStatus;
};

export const startBrowserSourceSession = async (url: string): Promise<BrowserSourceSessionStatus> => {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    throw new Error("A URL is required to start browser capture.");
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = new URL(trimmed).toString();
  } catch {
    normalizedUrl = new URL(`https://${trimmed}`).toString();
  }

  if (runtimeState.controller) {
    runtimeState.lastStatus = await runtimeState.controller.stop();
    runtimeState.controller = null;
  }

  runtimeState.controller = await BrowserSourceCaptureController.start(normalizedUrl);
  runtimeState.lastStatus = await runtimeState.controller.status();
  return runtimeState.lastStatus;
};

export const stopBrowserSourceSession = async (): Promise<BrowserSourceSessionStatus> => {
  if (!runtimeState.controller) {
    return runtimeState.lastStatus;
  }

  runtimeState.lastStatus = await runtimeState.controller.stop();
  runtimeState.controller = null;
  return runtimeState.lastStatus;
};

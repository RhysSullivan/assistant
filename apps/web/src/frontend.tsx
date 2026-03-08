import { createRoot } from "react-dom/client";

class BrowserBuffer extends Uint8Array {}

const browserGlobal = globalThis as any;

if (browserGlobal.Buffer === undefined) {
  browserGlobal.Buffer = BrowserBuffer;
}

const { App } = await import("./main");

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(<App />);

import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from "electron";

const targetUrl = process.env.EXECUTOR_MENUBAR_TARGET_URL ?? "http://localhost:4312/menubar";
const consoleUrl = process.env.EXECUTOR_CONSOLE_URL ?? "http://localhost:4312/";

let tray = null;
let panelWindow = null;
let quitting = false;

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
      <rect x="2" y="2" width="12" height="12" rx="3" fill="black" />
      <circle cx="8" cy="8" r="2" fill="white" />
    </svg>
  `;

  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  ).resize({ width: 18, height: 18 });
  image.setTemplateImage(true);
  return image;
}

function createFallbackHtml(errorDescription) {
  return encodeURIComponent(`
    <html>
      <body style="margin:0;padding:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0d0f;color:#f4f4f5;">
        <h2 style="margin:0 0 10px;font-size:16px;">Executor menubar</h2>
        <p style="margin:0 0 12px;font-size:13px;opacity:.8;line-height:1.5;">
          Could not load <code>${targetUrl}</code>.
        </p>
        <p style="margin:0 0 16px;font-size:12px;opacity:.7;line-height:1.4;">
          Start the web app first with <code>bun run dev:executor:web</code>,
          then click Reload from the tray menu.
        </p>
        <p style="margin:0;font-size:11px;opacity:.6;">Error: ${errorDescription}</p>
      </body>
    </html>
  `);
}

function positionWindowNearTray() {
  if (!tray || !panelWindow) {
    return;
  }

  const trayBounds = tray.getBounds();
  const windowBounds = panelWindow.getBounds();
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  const y = process.platform === "darwin"
    ? Math.round(trayBounds.y + trayBounds.height + 6)
    : Math.round(trayBounds.y + trayBounds.height);

  panelWindow.setPosition(Math.max(0, x), Math.max(0, y), false);
}

function togglePanelWindow() {
  if (!panelWindow) {
    return;
  }

  if (panelWindow.isVisible()) {
    panelWindow.hide();
    return;
  }

  positionWindowNearTray();
  panelWindow.show();
  panelWindow.focus();
}

function createPanelWindow() {
  panelWindow = new BrowserWindow({
    width: 460,
    height: 700,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
    },
  });

  panelWindow.loadURL(targetUrl);

  panelWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  panelWindow.webContents.on("did-fail-load", (_event, _code, description, attemptedUrl) => {
    if (attemptedUrl.startsWith("data:text/html")) {
      return;
    }

    panelWindow?.loadURL(`data:text/html,${createFallbackHtml(description)}`);
  });

  panelWindow.on("blur", () => {
    panelWindow?.hide();
  });

  panelWindow.on("close", (event) => {
    if (quitting) {
      return;
    }

    event.preventDefault();
    panelWindow?.hide();
  });
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("Executor");
  tray.on("click", togglePanelWindow);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Full Console",
      click: () => {
        shell.openExternal(consoleUrl);
      },
    },
    {
      label: "Reload",
      click: () => {
        panelWindow?.loadURL(targetUrl);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
} else {
  app.on("before-quit", () => {
    quitting = true;
  });

  app.on("second-instance", () => {
    if (!panelWindow) {
      return;
    }

    if (!panelWindow.isVisible()) {
      positionWindowNearTray();
      panelWindow.show();
    }
    panelWindow.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === "darwin" && app.dock) {
      app.dock.hide();
    }

    createPanelWindow();
    createTray();
  });

  app.on("window-all-closed", (event) => {
    event.preventDefault();
  });
}

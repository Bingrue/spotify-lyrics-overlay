import { app, BrowserWindow, ipcMain } from "electron";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let callbackServer = null;
let callbackServerPromise = null;
let mainWindow = null;
let authWindow = null;
let pendingLoginResolver = null;
let pendingLoginRejecter = null;

function createWindow() {
  if (mainWindow) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    return mainWindow;
  }

  const win = new BrowserWindow({
    width: 1000,
    height: 220,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow = win;
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(true);
  mainWindow.loadURL("http://127.0.0.1:5173");

  return mainWindow;
}

function startCallbackServer() {
  if (callbackServer) {
    return Promise.resolve(callbackServer);
  }

  if (callbackServerPromise) {
    return callbackServerPromise;
  }

  callbackServerPromise = new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1:8888");

      console.log("Callback server received:", requestUrl.href);

      if (requestUrl.pathname !== "/callback") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      const authError = requestUrl.searchParams.get("error");

      console.log("Spotify callback code:", code);
      console.log("Spotify callback state:", state);

      response.writeHead(authError || !code ? 400 : 200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      response.end(
        authError || !code
          ? "<html><body><p>Spotify authentication failed. You can close this window.</p></body></html>"
          : "<html><body><p>Spotify authentication complete. You can close this window.</p></body></html>"
      );

      if (authError || !code) {
        pendingLoginRejecter?.(
          new Error(authError ? `Spotify authorization failed: ${authError}` : "Spotify did not return an authorization code.")
        );
      } else if (pendingLoginResolver) {
        pendingLoginResolver({ code, state });
      }

      pendingLoginResolver = null;
      pendingLoginRejecter = null;

      const windowToFocus = mainWindow || createWindow();
      windowToFocus.show();
      windowToFocus.focus();

      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
        authWindow = null;
      }
    });

    server.on("error", (error) => {
      callbackServerPromise = null;
      reject(error);
    });

    server.listen(8888, "127.0.0.1", () => {
      callbackServer = server;
      resolve(server);
    });
  });

  return callbackServerPromise;
}

ipcMain.handle("spotify:login", async (_event, config) => {
  await startCallbackServer();

  return new Promise((resolve, reject) => {
    pendingLoginResolver = resolve;
    pendingLoginRejecter = reject;

    console.log("Opening Spotify auth window:", config?.authUrl);

    authWindow = new BrowserWindow({
      parent: mainWindow || undefined,
      width: 520,
      height: 720,
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    authWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3 || validatedURL?.startsWith("http://127.0.0.1:8888/callback")) {
        return;
      }

      console.log("Spotify auth load failed:", errorCode, errorDescription);
      if (pendingLoginRejecter) {
        pendingLoginRejecter(new Error(`Spotify login failed: ${errorDescription} (${errorCode})`));
      }
      pendingLoginResolver = null;
      pendingLoginRejecter = null;
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }
      authWindow = null;
    });

    authWindow.on("closed", () => {
      authWindow = null;
      if (pendingLoginRejecter) {
        pendingLoginRejecter(new Error("Spotify login window was closed before authorization completed."));
        pendingLoginResolver = null;
        pendingLoginRejecter = null;
      }
    });

    authWindow.webContents.on("will-navigate", (_event, url) => {
      console.log("Spotify auth will-navigate to:", url);
    });

    authWindow.loadURL(config?.authUrl || "https://accounts.spotify.com/authorize");
  });
});

app.whenReady().then(() => {
  createWindow();
  startCallbackServer().catch((error) => {
    console.error("Spotify callback server failed to start:", error);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("lyrics:get", async (_event, track) => {
  if (!track?.trackName || !track?.artistName) {
    throw new Error("Track name and artist are required to find lyrics.");
  }

  const params = new URLSearchParams({
    track_name: track.trackName,
    artist_name: track.artistName,
  });

  if (track.albumName) {
    params.set("album_name", track.albumName);
  }
  if (Number.isFinite(track.duration)) {
    params.set("duration", String(Math.round(track.duration)));
  }

  const response = await fetch(`https://lrclib.net/api/get?${params}`, {
    headers: {
      "User-Agent": "spotify-lyrics-overlay/0.0.0",
    },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Lyrics request failed (${response.status}).`);
  }

  return response.json();
});

app.on("activate", () => {
  createWindow();
});

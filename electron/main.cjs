const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

let serverProcess = null;

function createWindow() {
  const win = new BrowserWindow({ width: 1200, height: 800 });

  const indexPath = app.isPackaged
    ? path.join(process.resourcesPath, "client", "dist", "index.html")
    : path.join(__dirname, "..", "client", "dist", "index.html");

  win.loadFile(indexPath);
}

app.whenReady().then(() => {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, "server", "index.js")
    : path.join(__dirname, "..", "server", "index.js");

  serverProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: "5050" },
    stdio: "ignore",
    windowsHide: true,
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

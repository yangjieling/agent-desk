import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDataDir } from "@agent-desk/db";

export interface WebDaemonOptions {
  host?: string;
  port?: number;
  dataDir?: string;
  openBrowser?: boolean;
}

const CLI_ENTRY = fileURLToPath(new URL("./index.js", import.meta.url));

export function webPidFile(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "web.pid");
}

export function webLogFile(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "web.log");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port, timeout: 300 });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPid(dataDir = defaultDataDir()): number | null {
  const fp = webPidFile(dataDir);
  if (!fs.existsSync(fp)) return null;
  try {
    const pid = Number(fs.readFileSync(fp, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return isPidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function writePid(dataDir: string, pid: number): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(webPidFile(dataDir), String(pid), "utf8");
}

export function clearPid(dataDir: string, onlyPid?: number): void {
  const fp = webPidFile(dataDir);
  try {
    if (onlyPid !== undefined && fs.existsSync(fp)) {
      const cur = Number(fs.readFileSync(fp, "utf8").trim());
      if (Number.isFinite(cur) && cur !== onlyPid) return;
    }
    fs.unlinkSync(fp);
  } catch {
    // ignore
  }
}

export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

export async function startBackground(opts: WebDaemonOptions = {}): Promise<number> {
  const host = opts.host ?? process.env.AD_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.AD_PORT ?? 19877);
  const dataDir = opts.dataDir ?? defaultDataDir();
  const url = `http://${host}:${port}/`;
  const pid = readPid(dataDir);

  if (await isPortOpen(host, port)) {
    const extra = pid ? ` (pid=${pid})` : "";
    console.log(`oh web 已在运行${extra}: ${url}`);
    if (opts.openBrowser) await openBrowser(url);
    return 0;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const logPath = webLogFile(dataDir);
  const logFd = fs.openSync(logPath, "a");

  const args = [
    CLI_ENTRY,
    "web",
    "--foreground",
    "--host",
    host,
    "--port",
    String(port),
    "--data-dir",
    dataDir,
  ];

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  child.unref();
  fs.closeSync(logFd);

  if (child.pid) writePid(dataDir, child.pid);

  for (let i = 0; i < 40; i++) {
    if (child.pid && !isPidAlive(child.pid)) {
      console.error(`[错误] 后台启动失败,见日志: ${logPath}`);
      clearPid(dataDir);
      return 1;
    }
    if (await isPortOpen(host, port)) {
      console.log(`oh web 已在后台启动: ${url}`);
      console.log(`日志: ${logPath}`);
      console.log("停止: oh web --stop");
      if (opts.openBrowser) await openBrowser(url);
      return 0;
    }
    await sleep(100);
  }

  console.error(`[错误] 启动超时,见日志: ${logPath}`);
  return 1;
}

export async function stopWeb(opts: WebDaemonOptions = {}): Promise<number> {
  const host = opts.host ?? process.env.AD_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.AD_PORT ?? 19877);
  const dataDir = opts.dataDir ?? defaultDataDir();
  let stopped = false;

  try {
    const res = await fetch(`http://${host}:${port}/api/shutdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    stopped = res.ok;
  } catch {
    const pid = readPid(dataDir);
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
        stopped = true;
      } catch {
        // ignore
      }
    }
  }

  if (!stopped) {
    console.log("未发现正在运行的 oh web");
    clearPid(dataDir);
    return 1;
  }

  for (let i = 0; i < 20; i++) {
    if (!(await isPortOpen(host, port))) break;
    await sleep(100);
  }
  clearPid(dataDir);
  console.log("oh web 已停止");
  return 0;
}

export function registerForegroundLifecycle(dataDir: string): void {
  writePid(dataDir, process.pid);
  const cleanup = () => clearPid(dataDir, process.pid);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);
}

import { spawnSync } from "node:child_process";

export interface AgentProbeResult {
  id: string;
  displayName: string;
  installed: boolean;
  path?: string;
  version?: string;
  error?: string;
}

const BIN_CONFIG: Record<string, { env: string; defaultBin: string }> = {
  claude: { env: "AD_CLAUDE_BIN", defaultBin: "claude" },
  codex: { env: "AD_CODEX_BIN", defaultBin: "codex" },
  cursor: { env: "AD_CURSOR_BIN", defaultBin: "agent" },
};

export function resolveAgentBin(agentId: string): string {
  const cfg = BIN_CONFIG[agentId];
  if (!cfg) return agentId;
  return (process.env[cfg.env] || cfg.defaultBin).trim();
}

function resolveExecutablePath(bin: string): string | undefined {
  if (bin.includes("/") || bin.includes("\\")) return bin;
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const which = spawnSync(whichCmd, [bin], { encoding: "utf8" });
  const line = which.stdout?.trim().split(/\r?\n/)[0]?.trim();
  return line || undefined;
}

function parseVersion(output: string): string | undefined {
  const line = output.trim().split(/\r?\n/).find((l) => l.trim());
  if (!line) return undefined;
  const match = line.match(/(\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?)/);
  return match?.[1] || line.slice(0, 80);
}

export function probeAgentCli(
  agentId: string,
  displayName: string,
  bin?: string,
): AgentProbeResult {
  const command = (bin || resolveAgentBin(agentId)).trim();
  if (!command) {
    return { id: agentId, displayName, installed: false, error: "empty command" };
  }

  const r = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    return {
      id: agentId,
      displayName,
      installed: false,
      error: r.error?.message || r.stderr?.trim() || `exit ${r.status ?? "unknown"}`,
    };
  }

  const version = parseVersion(`${r.stdout || ""}${r.stderr || ""}`);
  return {
    id: agentId,
    displayName,
    installed: true,
    path: resolveExecutablePath(command) || command,
    version,
  };
}

const PROBE_CACHE_TTL_MS = 60_000;
let probeCacheAt = 0;
let installedProbeCache: AgentProbeResult[] | null = null;

export function clearAgentProbeCache(): void {
  installedProbeCache = null;
  probeCacheAt = 0;
}

export function probeInstalledAgentProviders(
  backends: Array<{ id: string; displayName: string }>,
  options?: { fresh?: boolean },
): AgentProbeResult[] {
  const now = Date.now();
  if (!options?.fresh && installedProbeCache && now - probeCacheAt < PROBE_CACHE_TTL_MS) {
    return installedProbeCache;
  }

  const results = backends
    .map((backend) => probeAgentCli(backend.id, backend.displayName))
    .filter((r) => r.installed)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  installedProbeCache = results;
  probeCacheAt = now;
  return results;
}

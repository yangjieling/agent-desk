import { spawnSync } from "node:child_process";
import { resolveAgentBin } from "./probe.js";

export interface AgentModel {
  id: string;
  label: string;
  provider?: string;
  default?: boolean;
}

export interface AgentModelCatalog {
  supported: boolean;
  models: AgentModel[];
  fallback?: boolean;
}

/** Prefer explicit setting; fall back to AD_*_MODEL env when empty. */
export function resolveAgentModel(explicit?: string, envFallback?: string): string {
  return (explicit || envFallback || "").trim();
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; catalog: AgentModelCatalog }>();

function cached(agentId: string, loader: () => AgentModelCatalog): AgentModelCatalog {
  const hit = cache.get(agentId);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.catalog;
  const catalog = loader();
  cache.set(agentId, { at: now, catalog });
  return catalog;
}

export function claudeStaticModels(): AgentModel[] {
  return [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", default: true },
    { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic" },
    { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", provider: "anthropic" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "anthropic" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic" },
  ];
}

export function codexStaticModels(): AgentModel[] {
  return [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", default: true },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai" },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai" },
    { id: "gpt-5.5", label: "GPT-5.5", provider: "openai" },
    { id: "gpt-5.4", label: "GPT-5.4", provider: "openai" },
    { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", provider: "openai" },
    { id: "gpt-5.2", label: "GPT-5.2", provider: "openai" },
  ];
}

export function cursorStaticModels(): AgentModel[] {
  return [{ id: "auto", label: "Auto", provider: "cursor", default: true }];
}

interface CodexDebugModel {
  slug?: string;
  display_name?: string;
  visibility?: string;
}

function parseCodexModelCatalog(raw: string): AgentModel[] {
  let resp: { models?: CodexDebugModel[] };
  try {
    resp = JSON.parse(raw) as { models?: CodexDebugModel[] };
  } catch {
    return [];
  }
  const models: AgentModel[] = [];
  for (const m of resp.models ?? []) {
    if (!m.slug || m.visibility === "hide") continue;
    models.push({
      id: m.slug,
      label: m.display_name || m.slug,
      provider: "openai",
    });
  }
  if (models.length > 0) models[0].default = true;
  return models;
}

function discoverCodexModels(bin: string): AgentModelCatalog {
  const r = spawnSync(bin, ["debug", "models", "--bundled"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (r.error || r.status !== 0 || !r.stdout?.trim()) {
    return { supported: true, models: codexStaticModels(), fallback: true };
  }
  const models = parseCodexModelCatalog(r.stdout);
  if (!models.length) {
    return { supported: true, models: codexStaticModels(), fallback: true };
  }
  return { supported: true, models };
}

function parseCursorModels(output: string): AgentModel[] {
  const models: AgentModel[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(" - ");
    if (idx <= 0) continue;
    const id = trimmed.slice(0, idx).trim();
    let label = trimmed.slice(idx + 3).trim();
    if (!/^[\w./-]+$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const isDefault = label.includes("default");
    const paren = label.indexOf("(");
    if (paren > 0) label = label.slice(0, paren).trim();
    if (!label) label = id;
    models.push({ id, label, provider: "cursor", default: isDefault });
  }
  return models;
}

function discoverCursorModels(bin: string): AgentModelCatalog {
  const r = spawnSync(bin, ["--list-models"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (r.error || r.status !== 0 || !r.stdout?.trim()) {
    return { supported: true, models: cursorStaticModels(), fallback: true };
  }
  const models = parseCursorModels(r.stdout);
  if (!models.length) {
    return { supported: true, models: cursorStaticModels(), fallback: true };
  }
  return { supported: true, models };
}

export function listModelsForAgent(agentId: string, bin?: string): AgentModelCatalog {
  return cached(agentId, () => {
    switch (agentId) {
      case "claude":
        return { supported: true, models: claudeStaticModels() };
      case "codex":
        return discoverCodexModels(bin || resolveAgentBin("codex"));
      case "cursor":
        return discoverCursorModels(bin || resolveAgentBin("cursor"));
      default:
        return { supported: false, models: [] };
    }
  });
}

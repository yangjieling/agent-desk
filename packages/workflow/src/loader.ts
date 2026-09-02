import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { Workflow, WorkflowMode, WorkflowNode } from "@agent-desk/core";

const MODES: WorkflowMode[] = ["shared", "independent"];

function repoTemplatesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../templates/workflows");
}

function normalizeNodes(raw: unknown): WorkflowNode[] {
  if (!Array.isArray(raw)) return [];
  const nodes: WorkflowNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const skill = String(rec.skill ?? "").trim();
    if (!skill) continue;
    const agentProfileId = String(rec.agentProfileId ?? rec.agent_profile_id ?? "").trim();
    nodes.push({
      id: String(rec.id ?? `n_${nodes.length + 1}`).trim(),
      skill,
      title: String(rec.title ?? skill).trim() || skill,
      prompt: String(rec.prompt ?? "").trim(),
      ...(agentProfileId ? { agentProfileId } : {}),
      requireGate: !!rec.requireGate || !!rec.require_gate,
      onFailure: (() => {
        const raw = String(rec.onFailure ?? rec.on_failure ?? "stop").trim();
        return raw === "continue" || raw === "retry" ? raw : "stop";
      })(),
    });
  }
  return nodes;
}

function normalizeWorkflow(data: Record<string, unknown>, source: "system" | "user"): Workflow {
  const modeRaw = String(data.mode ?? "shared").trim();
  const mode = MODES.includes(modeRaw as WorkflowMode) ? (modeRaw as WorkflowMode) : "shared";
  const nodes = normalizeNodes(data.nodes);
  if (!nodes.length) throw new Error("Workflow must contain at least one node");
  const now = Date.now();
  return {
    id: String(data.id ?? "").trim(),
    name: String(data.name ?? "Untitled").trim(),
    description: String(data.description ?? "").trim() || undefined,
    mode,
    source,
    nodes,
    createdAt: Number(data.createdAt ?? data.created_at ?? now),
    updatedAt: Number(data.updatedAt ?? data.updated_at ?? now),
  };
}

function readWorkflowFile(filePath: string, source: "system" | "user"): Workflow | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  let data: Record<string, unknown>;
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    data = parseYaml(text) as Record<string, unknown>;
  } else {
    data = JSON.parse(text) as Record<string, unknown>;
  }
  if (!data.id) data.id = path.basename(filePath).replace(/\.(json|ya?ml)$/i, "");
  return normalizeWorkflow(data, source);
}

function listFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => path.join(dir, f));
}

export function userWorkflowsDir(dataDir: string): string {
  return path.join(dataDir, "workflows");
}

export function listWorkflows(dataDir: string): Workflow[] {
  const items: Workflow[] = [];
  for (const fp of listFiles(repoTemplatesDir(), [".yaml", ".yml", ".json"])) {
    const wf = readWorkflowFile(fp, "system");
    if (wf) items.push(wf);
  }
  for (const fp of listFiles(userWorkflowsDir(dataDir), [".yaml", ".yml", ".json"])) {
    const wf = readWorkflowFile(fp, "user");
    if (wf) items.push(wf);
  }
  return items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function getWorkflow(dataDir: string, workflowId: string): Workflow | null {
  const id = workflowId.trim();
  if (!id) return null;
  return listWorkflows(dataDir).find((w) => w.id === id) ?? null;
}

export function saveUserWorkflow(dataDir: string, workflow: Workflow): Workflow {
  const dir = userWorkflowsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const id = String(workflow.id || "").trim();
  if (!id) throw new Error("workflow id required");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) {
    throw new Error("invalid workflow id (use letters, digits, ._- ; max 64)");
  }
  if (id.startsWith("sys-")) throw new Error("user workflow id cannot start with sys-");
  const existing = getWorkflow(dataDir, id);
  if (existing?.source === "system") throw new Error("cannot overwrite system workflow");

  const modeRaw = String(workflow.mode || "shared").trim();
  const mode = MODES.includes(modeRaw as WorkflowMode) ? (modeRaw as WorkflowMode) : "shared";
  const nodes = normalizeNodes(workflow.nodes);
  if (!nodes.length) throw new Error("Workflow must contain at least one node");

  const doc: Workflow = {
    id,
    name: String(workflow.name || id).trim() || id,
    description: String(workflow.description || "").trim() || undefined,
    mode,
    source: "user",
    nodes,
    createdAt: existing?.createdAt ?? workflow.createdAt ?? now,
    updatedAt: now,
  };
  const fp = path.join(dir, `${doc.id}.json`);
  fs.writeFileSync(fp, JSON.stringify(doc, null, 2), "utf8");
  return doc;
}

export function deleteUserWorkflow(dataDir: string, workflowId: string): { ok: true; id: string } {
  const id = workflowId.trim();
  if (!id) throw new Error("workflow id required");
  const wf = getWorkflow(dataDir, id);
  if (!wf) throw new Error(`Workflow not found: ${id}`);
  if (wf.source === "system") throw new Error("系统流程不能删除");
  const dir = userWorkflowsDir(dataDir);
  const candidates = [`${id}.json`, `${id}.yaml`, `${id}.yml`];
  let removed = false;
  for (const name of candidates) {
    const fp = path.join(dir, name);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      removed = true;
    }
  }
  if (!removed) throw new Error(`Workflow file not found: ${id}`);
  return { ok: true, id };
}

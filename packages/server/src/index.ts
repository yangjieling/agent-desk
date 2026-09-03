import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { clipPrompt, clipTitle, extractTaskUsageFromLog, newAgentId, newAutopilotId, newAutopilotWebhookSecret, newAutopilotWebhookToken, parseGate, type AgentProfile, type Autopilot } from "@agent-desk/core";
import { defaultDataDir, openDb } from "@agent-desk/db";
import { registerClaudeBackend } from "@agent-desk/provider-agent-claude";
import { registerCodexBackend } from "@agent-desk/provider-agent-codex";
import { registerCursorBackend } from "@agent-desk/provider-agent-cursor";
import { getAgentBackend, listAgentRuntimes, listInstalledAgentProviders, reconcileModelForAgent } from "@agent-desk/provider-agent";
import { getIssueProvider, listIssueProviders } from "@agent-desk/provider-issue";
import { registerGitHubIssueProvider, ensureIssueWorkspace, setGitHubSettingsSource } from "@agent-desk/provider-issue-github";
import { registerGitLabIssueProvider, setGitLabSettingsSource } from "@agent-desk/provider-issue-gitlab";
import { registerManualIssueProvider } from "@agent-desk/provider-issue-manual";
import {
  createDingTalkGateResumeHandler,
  registerDingTalkNotifyProvider,
  resolveDingTalkConfig,
  setDingTalkSettingsSource,
  startDingTalkCardStream,
} from "@agent-desk/provider-notify-dingtalk";
import { registerFeishuNotifyProvider } from "@agent-desk/provider-notify-feishu";
import { listNotifyProviders } from "@agent-desk/provider-notify";
import { registerWebhookNotifyProvider, setNotifyWebhookSettingsSource } from "@agent-desk/provider-notify-webhook";
import { listSkillSummaries, resolveSkill, ensureSkillsReady, syncBundledSkills, seedUserSkills, uninstallUserSkill } from "@agent-desk/skills";
import {
  abortRunningTask,
  bootstrapTaskQueue,
  createTask,
  enqueueStartTask,
  getLocalExecutor,
  isTaskRunning,
  processWorkspaceQueue,
  resumeTask,
  startLocalExecutor,
  startTask,
  startTaskWatchdog,
  stopLocalExecutor,
  stopTask,
  stopTaskWatchdog,
  subscribeTaskUpdates,
} from "@agent-desk/runner";
import type { TaskStreamUpdate } from "@agent-desk/runner";
import {
  continueRun,
  deleteUserWorkflow,
  getRun,
  getWorkflow,
  listRuns,
  listWorkflows,
  registerWorkflowHooks,
  saveUserWorkflow,
  startRun,
  stopRun,
} from "@agent-desk/workflow";
import {
  DEFAULT_DINGTALK_SETTINGS,
  DEFAULT_GITHUB_SETTINGS,
  DEFAULT_GITLAB_SETTINGS,
  DEFAULT_NOTIFY_WEBHOOK_SETTINGS,
  type DingTalkSettings,
  type GitHubSettings,
  type GitLabSettings,
  type NotifyWebhookSettings,
  type Settings,
  type Task,
} from "@agent-desk/core";
import { browse as fsBrowse, mkdir as fsMkdir } from "./fs-browser.js";
import {
  advanceAutopilotSchedule,
  dispatchAutopilot,
} from "./autopilot-dispatch.js";
import { startAutopilotScheduler, stopAutopilotScheduler } from "./autopilot-scheduler.js";
import { previewCronOccurrences, validateCronExpression } from "./cron-next.js";
import {
  AUTOPILOT_WEBHOOK_MAX_BYTES,
  formatWebhookPayloadBlock,
  headerString,
  resolveWebhookDeliveryKey,
  verifyHubSignature256,
} from "./autopilot-webhook.js";
import { assignWorkItem, triggerMentionRuns } from "./work-item-dispatch.js";

/** Mask stored secrets in API responses (UI shows placeholder; blank save keeps old). */
const SECRET_MASK = "********";

function redactSettings(settings: Settings): Settings {
  const dt = { ...settings.dingtalk };
  if (dt.secret) dt.secret = SECRET_MASK;
  if (dt.appSecret) dt.appSecret = SECRET_MASK;
  const gh = { ...settings.github };
  if (gh.token) gh.token = SECRET_MASK;
  const gl = { ...settings.gitlab };
  if (gl.token) gl.token = SECRET_MASK;
  return { ...settings, dingtalk: dt, github: gh, gitlab: gl };
}

function keepSecret(incoming: string | undefined, current: string): string {
  const v = (incoming ?? "").trim();
  if (!v || v === SECRET_MASK) return current;
  return v;
}

function isTaskStreamLive(task: Task): boolean {
  return (
    task.status === "running" ||
    task.status === "awaiting" ||
    task.status === "queued" ||
    task.status === "dispatched" ||
    task.status === "created" ||
    isTaskRunning(task.id)
  );
}

function taskForSseStream(task: Task, omitResult: boolean): Task {
  if (!omitResult) return task;
  return { ...task, result: "" };
}

function mergeDingTalkSettings(
  cur: DingTalkSettings,
  patch: Partial<DingTalkSettings>,
): DingTalkSettings {
  return {
    ...DEFAULT_DINGTALK_SETTINGS,
    ...cur,
    ...patch,
    secret: keepSecret(patch.secret, cur.secret),
    appSecret: keepSecret(patch.appSecret, cur.appSecret),
  };
}

function mergeGitHubSettings(
  cur: GitHubSettings,
  patch: Partial<GitHubSettings>,
): GitHubSettings {
  return {
    ...DEFAULT_GITHUB_SETTINGS,
    ...cur,
    ...patch,
    token: keepSecret(patch.token, cur.token),
  };
}

function mergeGitLabSettings(
  cur: GitLabSettings,
  patch: Partial<GitLabSettings>,
): GitLabSettings {
  return {
    ...DEFAULT_GITLAB_SETTINGS,
    ...cur,
    ...patch,
    token: keepSecret(patch.token, cur.token),
  };
}

function mergeNotifyWebhookSettings(
  cur: NotifyWebhookSettings,
  patch: Partial<NotifyWebhookSettings>,
): NotifyWebhookSettings {
  return {
    ...DEFAULT_NOTIFY_WEBHOOK_SETTINGS,
    ...cur,
    ...patch,
  };
}

export interface ServerOptions {
  host?: string;
  port?: number;
  dataDir?: string;
}

function registerProviders(): void {
  registerClaudeBackend();
  registerCodexBackend();
  registerCursorBackend();
  registerManualIssueProvider();
  registerGitHubIssueProvider();
  registerGitLabIssueProvider();
  registerWebhookNotifyProvider();
  registerFeishuNotifyProvider();
  registerDingTalkNotifyProvider();
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
code{background:#f4f4f5;padding:.1rem .35rem;border-radius:4px}</style></head>
<body>${body}</body></html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uiPublicDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../ui/public");
}

/** Monorepo `schemas/openapi.yaml` (from packages/server/dist → ../../../schemas). */
function openApiSpecPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../schemas/openapi.yaml");
}

function swaggerUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>agent-desk API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
  <style>body{margin:0} .topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/openapi.yaml",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`;
}

function logAgentRuntimesAtStartup(): void {
  const runtimes = listAgentRuntimes({ fresh: true });
  const installed = runtimes.filter((r) => r.installed);
  if (!installed.length) {
    console.warn(
      "[runtimes] No agent CLI detected on PATH (claude / codex / agent). Install one before running tasks.",
    );
    return;
  }
  const summary = installed
    .map((r) => `${r.displayName}${r.version ? ` ${r.version}` : ""}`)
    .join(", ");
  console.log(`[runtimes] ${installed.length}/${runtimes.length} available: ${summary}`);
}

export async function createServer(opts: ServerOptions = {}) {
  registerProviders();
  logAgentRuntimesAtStartup();
  const dataDir = opts.dataDir ?? defaultDataDir();
  const skillsUserDir = path.join(dataDir, "skills");
  try {
    const ready = ensureSkillsReady({ userDir: skillsUserDir });
    const parts: string[] = [];
    if (ready.sync && (ready.sync.installed.length || ready.sync.updated.length)) {
      parts.push(
        `builtin +${ready.sync.installed.length} ~${ready.sync.updated.length}`,
      );
    }
    if (ready.seed.seeded.length) parts.push(`seeded ${ready.seed.seeded.length}`);
    if (ready.seed.demoted.length) parts.push(`demoted ${ready.seed.demoted.length}`);
    if (parts.length) console.log(`[skills] ${parts.join("; ")}`);
  } catch (e) {
    console.warn(`[skills] sync skipped: ${e instanceof Error ? e.message : e}`);
  }
  const db = openDb(dataDir);
  setDingTalkSettingsSource(() => db.getSettings());
  setGitHubSettingsSource(() => db.getSettings());
  setGitLabSettingsSource(() => db.getSettings());
  setNotifyWebhookSettingsSource(() => db.getSettings());
  const settings = db.getSettings();
  const runnerOpts = { db, settings, dataDir };
  registerWorkflowHooks(dataDir, runnerOpts);
  bootstrapTaskQueue(runnerOpts, startTask, { isLive: isTaskRunning });
  startLocalExecutor({
    ...runnerOpts,
    startTask,
  });
  startTaskWatchdog(
    runnerOpts,
    startTask,
    {
      isLive: isTaskRunning,
      abortLive: abortRunningTask,
    },
    30_000,
  );

  const app = Fastify({ logger: true });

  // Preserve raw JSON body for webhook HMAC (X-Hub-Signature-256).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      const text = typeof body === "string" ? body : String(body ?? "");
      (req as { rawBody?: string }).rawBody = text;
      if (!text) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(text));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(fastifyStatic, {
    root: uiPublicDir(),
    prefix: "/static/",
  });

  app.get("/", async (_req, reply) => {
    return reply.sendFile("index.html");
  });

  app.get("/openapi.yaml", async (_req, reply) => {
    try {
      const yaml = await readFile(openApiSpecPath(), "utf8");
      return reply.type("application/yaml; charset=utf-8").send(yaml);
    } catch (e) {
      return reply.code(404).send({
        error: "openapi_missing",
        hint: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/openapi.yaml", async (_req, reply) => {
    try {
      const yaml = await readFile(openApiSpecPath(), "utf8");
      return reply.type("application/yaml; charset=utf-8").send(yaml);
    } catch (e) {
      return reply.code(404).send({
        error: "openapi_missing",
        hint: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/api/docs", async (_req, reply) => {
    return reply.type("text/html; charset=utf-8").send(swaggerUiHtml());
  });

  app.get("/api/health", async () => {
    const runtimes = listAgentRuntimes();
    const installed = runtimes.filter((r) => r.installed);
    const executor = getLocalExecutor()?.getStatus() ?? null;
    return {
      ok: true,
      version: "0.2.0",
      runtimes: {
        installed: installed.length,
        total: runtimes.length,
        providers: installed.map((r) => r.id),
      },
      executor,
    };
  });

  app.get("/api/executor", async () => {
    const executor = getLocalExecutor()?.getStatus();
    if (!executor) {
      return {
        online: false,
        mode: "in_process",
        hint: "local executor not started",
      };
    }
    return executor;
  });

  app.get("/api/dashboard", async () => {
    const tasks = db.listTasks(300);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const awaiting = tasks.filter((t) => t.status === "awaiting");
    const active = tasks.filter(
      (t) =>
        t.status === "running" ||
        t.status === "created" ||
        t.status === "queued" ||
        t.status === "dispatched",
    );
    const doneWeek = tasks.filter((t) => t.status === "done" && Number(t.updatedAt) >= weekAgo);
    const inReview = db.listWorkItemsByStatus("in_review", 100);

    const summarize = (t: (typeof tasks)[number]) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      skill: t.skill,
      issueCode: t.issueCode,
      projectDir: t.projectDir,
      workflowName: t.workflowName,
      updatedAt: t.updatedAt,
      lastActivityAt: t.lastActivityAt,
    });

    let openIssueCount = 0;
    try {
      const issueProviderId = db.getSettings().providers.issue || "manual";
      const provider = getIssueProvider(issueProviderId);
      // Count-only for overview; AI 修复 / 工作项入口在缺陷列表，不在总览重复。
      const issues = await provider.listIssues({ state: "open", limit: 30 });
      openIssueCount = issues.length;
    } catch {
      openIssueCount = 0;
    }

    return {
      ok: true,
      awaiting_count: awaiting.length,
      in_review_count: inReview.length,
      inbox_count: awaiting.length + inReview.length,
      active_count: active.length,
      done_week_count: doneWeek.length,
      open_issue_count: openIssueCount,
      awaiting_tasks: awaiting.slice(0, 12).map(summarize),
      in_review_items: inReview.slice(0, 12).map((w) => ({
        id: w.id,
        title: w.title,
        status: w.status,
        issueCode: w.issueCode,
        projectDir: w.projectDir,
        updatedAt: w.updatedAt,
        lastActivityAt: w.lastActivityAt,
      })),
    };
  });

  app.get("/api/inbox", async () => {
    const gateTasks = db
      .listTasks(300)
      .filter((t) => t.status === "awaiting")
      .sort((a, b) => Number(b.lastActivityAt || b.updatedAt) - Number(a.lastActivityAt || a.updatedAt));

    const gateItems = gateTasks.map((t) => {
      const gate = parseGate(t.result || "");
      return {
        taskId: t.id,
        workItemId: t.workItemId || "",
        type: "gate" as const,
        title: t.title,
        status: t.status,
        gateHeading: gate?.heading || null,
        gateName: gate?.name || null,
        choices: gate?.choices || [],
        skill: t.skill || "",
        workflowName: t.workflowName || "",
        issueCode: t.issueCode || "",
        projectDir: t.projectDir || "",
        agentProfileId: t.agentProfileId || "",
        updatedAt: t.updatedAt,
        lastActivityAt: t.lastActivityAt,
      };
    });

    const reviewItems = db.listWorkItemsByStatus("in_review", 100).map((w) => {
      const tasks = db.listTasksForWorkItem(w.id, 20);
      const latestDone =
        tasks.find((t) => t.status === "done") ||
        tasks[0] ||
        null;
      return {
        type: "acceptance" as const,
        workItemId: w.id,
        taskId: latestDone?.id || "",
        title: w.title,
        status: w.status,
        gateHeading: "执行已完成，等待验收",
        gateName: null,
        choices: [],
        skill: latestDone?.skill || "",
        workflowName: latestDone?.workflowName || "",
        issueCode: w.issueCode || "",
        projectDir: w.projectDir || latestDone?.projectDir || "",
        agentProfileId: w.agentProfileId || latestDone?.agentProfileId || "",
        updatedAt: w.updatedAt,
        lastActivityAt: w.lastActivityAt,
      };
    });

    const items = [...gateItems, ...reviewItems].sort(
      (a, b) => Number(b.lastActivityAt || b.updatedAt) - Number(a.lastActivityAt || a.updatedAt),
    );

    return { ok: true, count: items.length, items };
  });

  app.get<{ Querystring: { path?: string } }>("/api/fs/browse", async (req) => {
    return fsBrowse((req.query.path || "").trim());
  });

  app.post<{ Body: { path?: string; name?: string } }>("/api/fs/mkdir", async (req) => {
    return fsMkdir((req.body?.path || "").trim(), (req.body?.name || "").trim());
  });

  app.get<{ Querystring: { revealSecrets?: string } }>("/api/settings", async (req) => {
    const settings = db.getSettings();
    const reveal =
      req.query.revealSecrets === "1" ||
      req.query.revealSecrets === "true";
    return reveal ? settings : redactSettings(settings);
  });

  app.put<{ Body: Record<string, unknown> }>("/api/settings", async (req) => {
    const cur = db.getSettings();
    const body = req.body || {};
    const next = { ...cur, ...body } as typeof cur;
    if (body.providers && typeof body.providers === "object") {
      next.providers = {
        ...cur.providers,
        ...(body.providers as Partial<typeof cur.providers>),
      };
    }
    if (body.dingtalk && typeof body.dingtalk === "object") {
      next.dingtalk = mergeDingTalkSettings(
        cur.dingtalk,
        body.dingtalk as Partial<DingTalkSettings>,
      );
    } else {
      next.dingtalk = cur.dingtalk;
    }
    if (body.github && typeof body.github === "object") {
      next.github = mergeGitHubSettings(
        cur.github,
        body.github as Partial<GitHubSettings>,
      );
    } else {
      next.github = cur.github;
    }
    if (body.gitlab && typeof body.gitlab === "object") {
      next.gitlab = mergeGitLabSettings(
        cur.gitlab ?? DEFAULT_GITLAB_SETTINGS,
        body.gitlab as Partial<GitLabSettings>,
      );
    } else {
      next.gitlab = cur.gitlab ?? DEFAULT_GITLAB_SETTINGS;
    }
    if (body.notifyWebhook && typeof body.notifyWebhook === "object") {
      next.notifyWebhook = mergeNotifyWebhookSettings(
        cur.notifyWebhook,
        body.notifyWebhook as Partial<NotifyWebhookSettings>,
      );
    } else {
      next.notifyWebhook = cur.notifyWebhook;
    }
    const agentChanged =
      typeof body.defaultAgentId === "string" &&
      body.defaultAgentId.trim() !== cur.defaultAgentId;
    if (agentChanged && body.defaultAgentId) {
      const profile = db.getAgent(String(body.defaultAgentId).trim());
      if (profile) next.codingAgent = profile.provider;
    }
    const providerChanged =
      typeof body.codingAgent === "string" &&
      body.codingAgent.trim() &&
      body.codingAgent.trim() !== cur.codingAgent;
    if (providerChanged) {
      try {
        const backend = getAgentBackend(next.codingAgent);
        const catalog = await backend.listModels();
        next.defaultModel = reconcileModelForAgent(next.defaultModel, catalog.models);
      } catch {
        next.defaultModel = "";
      }
    }
    db.saveSettings(next);
    return redactSettings(next);
  });

  app.get("/api/issue-providers", async () =>
    listIssueProviders().map((p) => ({ id: p.id, displayName: p.displayName })),
  );

  app.get<{ Querystring: { fresh?: string } }>("/api/runtimes", async (req) => {
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";
    const runtimes = listAgentRuntimes({ fresh });
    const installed = runtimes.filter((r) => r.installed);
    return {
      runtimes,
      installedCount: installed.length,
      totalCount: runtimes.length,
      probedAt: Date.now(),
    };
  });

  app.get<{ Querystring: { fresh?: string } }>("/api/agent-providers", async (req) => {
    const fresh = req.query.fresh === "1" || req.query.fresh === "true";
    return listInstalledAgentProviders({ fresh });
  });

  app.get("/api/agents", async () => db.listAgents());

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const agent = db.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: "not_found" });
    return agent;
  });

  app.post<{
    Body: {
      name?: string;
      provider?: string;
      model?: string;
      defaultSkill?: string;
      instructions?: string;
    };
  }>("/api/agents", async (req, reply) => {
    const name = String(req.body.name || "").trim();
    const provider = String(req.body.provider || "").trim();
    if (!name) return reply.code(400).send({ error: "name_required" });
    if (!provider) return reply.code(400).send({ error: "provider_required" });
    try {
      getAgentBackend(provider);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    const now = Date.now();
    const agent: AgentProfile = {
      id: newAgentId(),
      name,
      provider,
      model: String(req.body.model || "").trim(),
      defaultSkill: String(req.body.defaultSkill || "default").trim() || "default",
      instructions: String(req.body.instructions || "").trim(),
      createdAt: now,
      updatedAt: now,
    };
    db.upsertAgent(agent);
    return agent;
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      provider?: string;
      model?: string;
      defaultSkill?: string;
      instructions?: string;
    };
  }>("/api/agents/:id", async (req, reply) => {
    const current = db.getAgent(req.params.id);
    if (!current) return reply.code(404).send({ error: "not_found" });
    const provider = String(req.body.provider ?? current.provider).trim();
    try {
      getAgentBackend(provider);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    const now = Date.now();
    const agent: AgentProfile = {
      ...current,
      name: String(req.body.name ?? current.name).trim() || current.name,
      provider,
      model: String(req.body.model ?? current.model).trim(),
      defaultSkill: String(req.body.defaultSkill ?? current.defaultSkill).trim() || "default",
      instructions: String(req.body.instructions ?? current.instructions).trim(),
      updatedAt: now,
    };
    db.upsertAgent(agent);
    const settings = db.getSettings();
    if (settings.defaultAgentId === agent.id) {
      db.saveSettings({ ...settings, codingAgent: agent.provider });
    }
    return agent;
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const current = db.getAgent(req.params.id);
    if (!current) return reply.code(404).send({ error: "not_found" });
    const settings = db.getSettings();
    if (settings.defaultAgentId === current.id) {
      const remaining = db.listAgents().filter((a) => a.id !== current.id);
      db.saveSettings({
        ...settings,
        defaultAgentId: remaining[0]?.id || "",
        codingAgent: remaining[0]?.provider || settings.codingAgent,
      });
    }
    db.deleteAgent(current.id);
    return { ok: true };
  });

  app.get<{ Querystring: { agent?: string } }>("/api/agent-models", async (req, reply) => {
    const agentId = (req.query.agent || db.getSettings().codingAgent || "claude").trim();
    try {
      const backend = getAgentBackend(agentId);
      return await backend.listModels();
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/notify-providers", async () =>
    listNotifyProviders().map((p) => ({ id: p.id, displayName: p.displayName })),
  );

  app.post("/api/github/resolve-workspace", async (_req, reply) => {
    if (db.getSettings().providers.issue !== "github") {
      return reply.code(400).send({ error: "issue_provider_not_github" });
    }
    try {
      return await ensureIssueWorkspace(dataDir);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get<{ Querystring: { cwd?: string } }>("/api/skills", async (req) => {
    const cwd = (req.query.cwd || "").trim() || process.cwd();
    return listSkillSummaries({ cwd, userDir: skillsUserDir });
  });

  app.get<{ Params: { id: string }; Querystring: { cwd?: string } }>(
    "/api/skills/:id",
    async (req, reply) => {
      const cwd = (req.query.cwd || "").trim() || process.cwd();
      const skill = resolveSkill(req.params.id, { cwd, userDir: skillsUserDir });
      if (!skill) return reply.code(404).send({ error: "not_found" });
      return skill;
    },
  );

  app.post<{ Body: { force?: boolean } }>("/api/skills/sync", async (req) => {
    const force = !!req.body?.force;
    const sync = syncBundledSkills({ force, userDir: skillsUserDir });
    const seed = seedUserSkills({ userDir: skillsUserDir });
    return { sync, seed };
  });

  app.delete<{ Params: { id: string } }>("/api/skills/:id", async (req, reply) => {
    try {
      return uninstallUserSkill(req.params.id, { userDir: skillsUserDir });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = /内置|不能卸载/.test(msg) ? 403 : /not found/.test(msg) ? 404 : 400;
      return reply.code(code).send({ error: msg });
    }
  });

  app.get<{
    Querystring: { state?: string; label?: string | string[]; limit?: string; provider?: string };
  }>("/api/issues", async (req, reply) => {
    const providerId =
      (req.query.provider || db.getSettings().providers.issue || "manual").trim();
    let provider;
    try {
      provider = getIssueProvider(providerId);
    } catch (e) {
      return reply.code(400).send({
        error: e instanceof Error ? e.message : String(e),
        hint:
          providerId === "github"
            ? "Configure GitHub in Settings → GitHub, or set AD_GITHUB_REPO and AD_GITHUB_TOKEN"
            : undefined,
      });
    }
    const stateRaw = (req.query.state || "all").trim();
    const state =
      stateRaw === "closed" || stateRaw === "open" ? stateRaw : "all";
    const labelRaw = req.query.label;
    const labels = Array.isArray(labelRaw)
      ? labelRaw
      : labelRaw
        ? [labelRaw]
        : undefined;
    try {
      return await provider.listIssues({
        state,
        labels,
        limit: Number(req.query.limit) || 30,
      });
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get<{ Params: { code: string }; Querystring: { provider?: string } }>(
    "/api/issues/:code",
    async (req, reply) => {
      const providerId =
        (req.query.provider || db.getSettings().providers.issue || "manual").trim();
      let provider;
      try {
        provider = getIssueProvider(providerId);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
      try {
        const issue = await provider.getIssue(decodeURIComponent(req.params.code));
        if (!issue) return reply.code(404).send({ error: "not_found" });
        return issue;
      } catch (e) {
        return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
      }
    },
  );

  app.get("/api/work-items", async () => db.listWorkItems(200));

  async function loadIssueSnapshot(item: {
    issueCode?: string;
    issueProvider?: string;
    description?: string;
  }): Promise<{
    code: string;
    title: string;
    status: string;
    severity: string;
    description: string;
    projectDir: string;
    url?: string;
    labels?: string[];
    updatedAt: number;
  } | null> {
    const code = String(item.issueCode || "").trim();
    if (!code) return null;
    const settings = db.getSettings();
    const providerId = (item.issueProvider || settings.providers.issue || "manual").trim();
    try {
      const provider = getIssueProvider(providerId);
      const issue = await provider.getIssue(code);
      if (!issue) return null;
      // Backfill empty local description once for detail view persistence.
      if (!String(item.description || "").trim() && String(issue.description || "").trim()) {
        const current = db.findWorkItemByIssue(providerId, code);
        if (current && !String(current.description || "").trim()) {
          db.upsertWorkItem({
            ...current,
            description: String(issue.description || "").trim().slice(0, 8000),
            updatedAt: Date.now(),
          });
        }
      }
      return {
        code: issue.code,
        title: issue.title,
        status: issue.status,
        severity: issue.severity,
        description: issue.description || "",
        projectDir: issue.projectDir || "",
        url: issue.url,
        labels: issue.labels,
        updatedAt: issue.updatedAt,
      };
    } catch {
      return null;
    }
  }

  app.get<{ Params: { id: string } }>("/api/work-items/:id", async (req, reply) => {
    const item = db.getWorkItem(req.params.id);
    if (!item) return reply.code(404).send({ error: "not_found" });
    db.syncWorkItemStatus(item.id);
    const refreshed = db.getWorkItem(item.id) ?? item;
    const tasks = db.listTasksForWorkItem(item.id, 200);
    const events = db.listWorkItemEvents(item.id, 200);
    const issue = await loadIssueSnapshot(refreshed);
    return { workItem: refreshed, tasks, events, issue };
  });

  app.get<{ Params: { id: string } }>("/api/work-items/:id/tasks", async (req, reply) => {
    const item = db.getWorkItem(req.params.id);
    if (!item) return reply.code(404).send({ error: "not_found" });
    return db.listTasksForWorkItem(item.id, 200);
  });

  app.get<{ Params: { id: string } }>("/api/work-items/:id/events", async (req, reply) => {
    const item = db.getWorkItem(req.params.id);
    if (!item) return reply.code(404).send({ error: "not_found" });
    return db.listWorkItemEvents(item.id, 200);
  });

  app.post<{ Params: { id: string }; Body: { body?: string; wake?: boolean } }>(
    "/api/work-items/:id/events",
    async (req, reply) => {
      const item = db.getWorkItem(req.params.id);
      if (!item) return reply.code(404).send({ error: "not_found" });
      const body = String(req.body?.body || "").trim();
      if (!body) return reply.code(400).send({ error: "body_required" });
      if (body.length > 4000) return reply.code(400).send({ error: "body_too_long" });
      const event = db.addWorkItemEvent({
        workItemId: item.id,
        kind: "note",
        author: "user",
        body,
      });
      if (!event) return reply.code(400).send({ error: "create_failed" });
      const wake = req.body?.wake !== false;
      const triggered = triggerMentionRuns(db, runnerOpts, item, body, { wake });
      return {
        ...event,
        mentions: triggered.mentions.map((m) => ({
          agentProfileId: m.agentProfileId,
          label: m.label,
        })),
        startedTaskIds: triggered.started.map((t) => t.id),
        coalescedTaskIds: triggered.coalesced.map((t) => t.id),
      };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { agentProfileId?: string; start?: boolean; note?: string };
  }>("/api/work-items/:id/assign", async (req, reply) => {
    const item = db.getWorkItem(req.params.id);
    if (!item) return reply.code(404).send({ error: "not_found" });
    try {
      const result = assignWorkItem(db, runnerOpts, item.id, {
        agentProfileId: req.body?.agentProfileId,
        start: req.body?.start,
        note: req.body?.note,
      });
      return {
        ok: true,
        workItem: result.workItem,
        started: result.started,
        coalesced: result.coalesced,
        skippedReason: result.skippedReason || undefined,
        task: result.task,
      };
    } catch (e) {
      const code = e instanceof Error && "code" in e ? String((e as { code?: string }).code || "") : "";
      if (code === "agent_not_found") return reply.code(400).send({ error: "agent_not_found" });
      if (code === "not_found") return reply.code(404).send({ error: "not_found" });
      return reply.code(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/work-items/:id/accept", async (req, reply) => {
    const item = db.getWorkItem(req.params.id);
    if (!item) return reply.code(404).send({ error: "not_found" });
    if (item.status !== "in_review") {
      return reply.code(409).send({ error: "not_in_review", status: item.status });
    }
    const next = db.acceptWorkItem(item.id);
    if (!next) return reply.code(409).send({ error: "accept_failed" });
    return { ok: true, workItem: next };
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    "/api/work-items/:id/reject",
    async (req, reply) => {
      const item = db.getWorkItem(req.params.id);
      if (!item) return reply.code(404).send({ error: "not_found" });
      if (item.status !== "in_review") {
        return reply.code(409).send({ error: "not_in_review", status: item.status });
      }
      const note = String(req.body?.note || "").trim().slice(0, 2000);
      const next = db.rejectWorkItem(item.id, note);
      if (!next) return reply.code(409).send({ error: "reject_failed" });
      return { ok: true, workItem: next };
    },
  );

  app.get<{ Params: { code: string }; Querystring: { provider?: string; title?: string; projectDir?: string } }>(
    "/api/issues/:code/work-item",
    async (req, reply) => {
      const code = decodeURIComponent(req.params.code || "").trim();
      if (!code) return reply.code(400).send({ error: "code_required" });
      const settings = db.getSettings();
      const issueProvider = (req.query.provider || settings.providers.issue || "manual").trim();
      let title = String(req.query.title || "").trim();
      let projectDir = String(req.query.projectDir || "").trim();
      let description = "";
      let issueSnap: Awaited<ReturnType<typeof loadIssueSnapshot>> = null;
      try {
        const provider = getIssueProvider(issueProvider);
        const issue = await provider.getIssue(code);
        if (issue) {
          if (!title) title = issue.title;
          if (!projectDir) projectDir = issue.projectDir;
          description = String(issue.description || "").trim();
          issueSnap = {
            code: issue.code,
            title: issue.title,
            status: issue.status,
            severity: issue.severity,
            description: issue.description || "",
            projectDir: issue.projectDir || "",
            url: issue.url,
            labels: issue.labels,
            updatedAt: issue.updatedAt,
          };
        }
      } catch {
        /* optional enrichment */
      }
      const workItem = db.resolveOrCreateWorkItem(
        { issueCode: code, issueProvider, title, projectDir, description },
        settings,
      );
      if (!workItem) return reply.code(400).send({ error: "work_item_unresolvable" });
      if (description && !String(workItem.description || "").trim()) {
        db.upsertWorkItem({
          ...workItem,
          description: description.slice(0, 8000),
          updatedAt: Date.now(),
        });
      }
      db.syncWorkItemStatus(workItem.id);
      const refreshed = db.getWorkItem(workItem.id) ?? workItem;
      const tasks = db.listTasksForWorkItem(workItem.id, 200);
      const events = db.listWorkItemEvents(workItem.id, 200);
      const issue = issueSnap || (await loadIssueSnapshot(refreshed));
      return { workItem: refreshed, tasks, events, issue };
    },
  );

  app.get("/api/tasks", async () => db.listTasks());

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    const usage = extractTaskUsageFromLog(task.result || "", task.codingAgent);
    return usage ? { ...task, usage } : task;
  });

  app.get<{ Params: { id: string }; Querystring: { offset?: string } }>(
    "/api/tasks/:id/log",
    async (req, reply) => {
      const task = db.getTask(req.params.id);
      if (!task) return reply.code(404).send({ error: "not_found" });
      const full = task.result ?? "";
      const offset = Math.max(0, Number.parseInt(req.query.offset ?? "0", 10) || 0);
      const safeOffset = Math.min(offset, full.length);
      return {
        offset: safeOffset,
        length: full.length,
        chunk: full.slice(safeOffset),
        status: task.status,
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { offset?: string } }>(
    "/api/tasks/:id/stream",
    async (req, reply) => {
    const taskId = req.params.id;
    const task = db.getTask(taskId);
    if (!task) return reply.code(404).send({ error: "not_found" });
    const clientOffset = Math.max(0, Number.parseInt(req.query.offset ?? "0", 10) || 0);
    const fullResult = task.result ?? "";
    const safeOffset = Math.min(clientOffset, fullResult.length);

    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    if (typeof reply.raw.flushHeaders === "function") reply.raw.flushHeaders();

    let closed = false;
    const writeEvent = (payload: object) => {
      if (closed) return;
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const finish = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      try {
        reply.raw.end();
      } catch {
        /* ignore */
      }
    };

    writeEvent({
      type: "snapshot",
      task: taskForSseStream(task, safeOffset > 0),
      resultAppend: safeOffset > 0 ? fullResult.slice(safeOffset) : undefined,
      resultLength: fullResult.length,
      resultOffset: safeOffset,
    });

    const onUpdate = (update: TaskStreamUpdate) => {
      const { task: updated, resultAppend } = update;
      const omitResult = !!resultAppend && resultAppend.length > 0;
      writeEvent({
        type: "update",
        task: taskForSseStream(updated, omitResult),
        resultAppend: resultAppend || undefined,
        resultLength: (updated.result ?? "").length,
      });
      if (!isTaskStreamLive(updated)) {
        writeEvent({ type: "end", status: updated.status });
        finish();
      }
    };

    const unsubscribe = subscribeTaskUpdates(taskId, onUpdate);

    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(": heartbeat\n\n");
    }, 20000);

    req.raw.on("close", finish);

    if (!isTaskStreamLive(task)) {
      writeEvent({ type: "end", status: task.status });
      finish();
    }
  });

  app.post<{
    Body: {
      title?: string;
      prompt?: string;
      projectDir?: string;
      issueCode?: string;
      workItemId?: string;
      skill?: string;
      agentProfileId?: string;
      codingAgent?: string;
      model?: string;
    };
  }>("/api/tasks", async (req, reply) => {
    const title = clipTitle(req.body.title ?? "Untitled task");
    const prompt = clipPrompt(req.body.prompt ?? "");
    if (!prompt.trim()) return reply.code(400).send({ error: "prompt_required" });

    const task = createTask(
      {
        title,
        prompt,
        projectDir: req.body.projectDir,
        issueCode: req.body.issueCode,
        workItemId: req.body.workItemId,
        skill: req.body.skill,
        agentProfileId: req.body.agentProfileId,
        codingAgent: req.body.codingAgent,
        model: req.body.model,
      },
      db.getSettings(),
      runnerOpts,
    );
    db.upsertTask(task);
    enqueueStartTask(runnerOpts, task.id);
    return task;
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/start", async (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    if (isTaskRunning(task.id) || task.status === "running") {
      return reply.code(409).send({ error: "already_running", task });
    }
    if (task.status === "dispatched") {
      return reply.code(409).send({ error: "already_dispatched", task });
    }
    if (!["created", "failed", "stopped", "queued"].includes(task.status)) {
      return reply.code(409).send({ error: "not_startable", status: task.status, task });
    }
    db.updateTask(task.id, {
      status: "queued",
      nextRetryAt: 0,
      failureMessage: "",
      failureCode: "",
      claimToken: "",
      claimedBy: "",
      claimedAt: 0,
      heartbeatAt: 0,
    });
    enqueueStartTask(runnerOpts, task.id);
    return db.getTask(task.id);
  });

  async function handleResume(taskId: string, replyText: string, model?: string) {
    const task = db.getTask(taskId);
    if (!task) return { ok: false as const, error: "not_found" as const };
    if (isTaskRunning(task.id) || task.status === "running") {
      return { ok: false as const, error: "already_running" as const, task };
    }
    const updated = await resumeTask(
      runnerOpts,
      taskId,
      replyText,
      model !== undefined ? { model } : undefined,
    );
    if (task.workflowRunId && updated?.status === "stopped") {
      try {
        stopRun(dataDir, runnerOpts, task.workflowRunId);
      } catch {
        // ignore
      }
    }
    return { ok: true as const, task: updated };
  }

  app.post<{ Params: { id: string }; Body: { reply?: string; model?: string } }>(
    "/api/tasks/:id/resume",
    async (req, reply) => {
      const model =
        typeof req.body.model === "string" ? req.body.model.trim() : undefined;
      const result = await handleResume(req.params.id, req.body.reply ?? "继续", model);
      if (!result.ok) {
        if (result.error === "already_running") {
          return reply.code(409).send({ error: "already_running", task: result.task });
        }
        return reply.code(404).send({ error: "not_found" });
      }
      return result.task;
    },
  );

  /** Feishu / browser deep-link: open URL to confirm a gate choice without POST body. */
  app.get<{ Params: { id: string }; Querystring: { reply?: string } }>(
    "/api/tasks/:id/resume",
    async (req, reply) => {
      const replyText = (req.query.reply ?? "继续").trim() || "继续";
      const result = await handleResume(req.params.id, replyText);
      if (!result.ok) {
        if (result.error === "already_running") {
          return reply
            .code(409)
            .type("text/html; charset=utf-8")
            .send(
              htmlPage(
                "任务进行中",
                `<h1>任务已在运行</h1><p>请勿重复提交回复。<code>${escHtml(req.params.id)}</code></p>
                 <p><a href="/?task=${encodeURIComponent(req.params.id)}">打开面板</a></p>`,
              ),
            );
        }
        return reply
          .code(404)
          .type("text/html; charset=utf-8")
          .send(
            htmlPage(
              "未找到任务",
              `<h1>未找到任务</h1><p><code>${escHtml(req.params.id)}</code></p>`,
            ),
          );
      }
      const status = result.task?.status ?? "";
      const title = result.task?.title ?? req.params.id;
      return reply.type("text/html; charset=utf-8").send(
        htmlPage(
          "已回复",
          `<h1>已提交回复</h1>
<p>任务 <strong>${escHtml(title)}</strong>（<code>${escHtml(req.params.id)}</code>）</p>
<p>回复：<code>${escHtml(replyText)}</code></p>
<p>当前状态：<code>${escHtml(status)}</code></p>
<p><a href="/?task=${encodeURIComponent(req.params.id)}">打开任务详情</a></p>`,
        ),
      );
    },
  );

  app.post<{ Params: { id: string } }>("/api/tasks/:id/stop", async (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    const projectDir = task.projectDir;
    stopTask(req.params.id);
    if (task.workflowRunId) {
      try {
        stopRun(dataDir, runnerOpts, task.workflowRunId);
      } catch {
        // ignore
      }
    } else {
      db.updateTask(req.params.id, {
        status: "stopped",
        nextRetryAt: 0,
        claimToken: "",
        claimedBy: "",
        claimedAt: 0,
        heartbeatAt: 0,
        failureMessage:
          (task.status === "queued" || task.status === "dispatched") && task.retryCount > 0
            ? "已取消自动重试"
            : task.failureMessage,
      });
      if (projectDir) {
        void processWorkspaceQueue(runnerOpts, projectDir, startTask);
      }
    }
    return db.getTask(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const task = db.getTask(req.params.id);
    if (task?.workflowRunId) {
      try {
        stopRun(dataDir, runnerOpts, task.workflowRunId);
      } catch {
        // ignore
      }
    }
    stopTask(req.params.id);
    const ok = db.deleteTask(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.get("/api/workflows", async () => listWorkflows(dataDir));

  app.get<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    const wf = getWorkflow(dataDir, req.params.id);
    if (!wf) return reply.code(404).send({ error: "not_found" });
    return wf;
  });

  app.post<{
    Body: {
      id?: string;
      name?: string;
      description?: string;
      mode?: string;
      nodes?: Array<{
        id?: string;
        skill?: string;
        title?: string;
        prompt?: string;
        requireGate?: boolean;
        onFailure?: string;
        agentProfileId?: string;
      }>;
    };
  }>("/api/workflows", async (req, reply) => {
    try {
      const body = req.body || {};
      const settings = db.getSettings();
      const mode =
        body.mode === "independent" || body.mode === "shared"
          ? body.mode
          : settings.defaultWorkflowMode || "shared";
      const saved = saveUserWorkflow(dataDir, {
        id: String(body.id || "").trim(),
        name: String(body.name || "").trim(),
        description: String(body.description || "").trim(),
        mode,
        source: "user",
        nodes: (body.nodes || []).map((n, i) => ({
          id: String(n.id || `n${i + 1}`).trim(),
          skill: String(n.skill || "").trim(),
          title: String(n.title || n.skill || `步骤 ${i + 1}`).trim(),
          prompt: String(n.prompt || "").trim(),
          ...(String(n.agentProfileId || "").trim()
            ? { agentProfileId: String(n.agentProfileId).trim() }
            : {}),
          requireGate: !!n.requireGate,
          onFailure:
            n.onFailure === "continue" || n.onFailure === "retry" ? n.onFailure : "stop",
        })),
      });
      return saved;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      mode?: string;
      nodes?: Array<{
        id?: string;
        skill?: string;
        title?: string;
        prompt?: string;
        requireGate?: boolean;
        onFailure?: string;
        agentProfileId?: string;
      }>;
    };
  }>("/api/workflows/:id", async (req, reply) => {
    const existing = getWorkflow(dataDir, req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.source === "system") {
      return reply.code(403).send({ error: "系统流程不能修改" });
    }
    try {
      const body = req.body || {};
      const mode =
        body.mode === "independent" || body.mode === "shared" ? body.mode : existing.mode;
      const saved = saveUserWorkflow(dataDir, {
        id: req.params.id,
        name: String(body.name ?? existing.name).trim(),
        description: String(body.description ?? existing.description ?? "").trim(),
        mode,
        source: "user",
        createdAt: existing.createdAt,
        nodes: (body.nodes || existing.nodes).map((n, i) => ({
          id: String(n.id || `n${i + 1}`).trim(),
          skill: String(n.skill || "").trim(),
          title: String(n.title || n.skill || `步骤 ${i + 1}`).trim(),
          prompt: String(n.prompt || "").trim(),
          ...(String((n as { agentProfileId?: string }).agentProfileId || "").trim()
            ? {
                agentProfileId: String(
                  (n as { agentProfileId?: string }).agentProfileId,
                ).trim(),
              }
            : {}),
          requireGate: !!(n as { requireGate?: boolean }).requireGate,
          onFailure:
            (n as { onFailure?: string }).onFailure === "continue" ||
            (n as { onFailure?: string }).onFailure === "retry"
              ? ((n as { onFailure: "continue" | "retry" }).onFailure)
              : "stop",
        })),
      });
      return saved;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/workflows/:id", async (req, reply) => {
    try {
      return deleteUserWorkflow(dataDir, req.params.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = /系统/.test(msg) ? 403 : /not found|Not found/i.test(msg) ? 404 : 400;
      return reply.code(code).send({ error: msg });
    }
  });

  app.post<{
    Params: { id: string };
    Body: { title?: string; prompt?: string; projectDir?: string; issueCode?: string; agentProfileId?: string };
  }>("/api/workflows/:id/run", async (req, reply) => {
    const wf = getWorkflow(dataDir, req.params.id);
    if (!wf) return reply.code(404).send({ error: "not_found" });
    try {
      const run = startRun(dataDir, runnerOpts, {
        workflowId: req.params.id,
        title: req.body.title,
        inputPrompt: req.body.prompt,
        projectDir: req.body.projectDir,
        issueCode: req.body.issueCode,
        agentProfileId: req.body.agentProfileId,
      });
      return run;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/api/workflow-runs", async () => listRuns(dataDir));

  app.get<{ Params: { id: string } }>("/api/workflow-runs/:id", async (req, reply) => {
    const run = getRun(dataDir, req.params.id);
    if (!run) return reply.code(404).send({ error: "not_found" });
    return run;
  });

  app.post<{ Params: { id: string } }>("/api/workflow-runs/:id/continue", async (req, reply) => {
    try {
      return continueRun(dataDir, runnerOpts, req.params.id);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/workflow-runs/:id/stop", async (req, reply) => {
    try {
      return stopRun(dataDir, runnerOpts, req.params.id);
    } catch (e) {
      return reply.code(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  const summarizeAutopilot = (ap: Autopilot, opts?: { revealSecrets?: boolean }) => {
    const runs = db.listAutopilotRuns(ap.id, 1);
    const lastRun = runs[0] || null;
    const reveal = Boolean(opts?.revealSecrets);
    const baseUrl = String(db.getSettings().webBaseUrl || "").replace(/\/$/, "") || "";
    const webhookUrl =
      ap.webhookToken && baseUrl
        ? `${baseUrl}/api/webhooks/autopilots/${ap.webhookToken}`
        : ap.webhookToken
          ? `/api/webhooks/autopilots/${ap.webhookToken}`
          : "";
    return {
      ...ap,
      webhookSecret: ap.webhookSecret
        ? reveal
          ? ap.webhookSecret
          : SECRET_MASK
        : "",
      webhookUrl,
      lastRun,
    };
  };

  type AutopilotBody = {
    name?: string;
    runbook?: string;
    status?: string;
    action?: string;
    executionMode?: string;
    skill?: string;
    workflowId?: string;
    projectDir?: string;
    agentProfileId?: string;
    model?: string;
    titleTemplate?: string;
    cronExpression?: string;
    timezone?: string;
    concurrencyPolicy?: string;
    webhookEnabled?: boolean;
  };

  function buildAutopilotFromBody(
    body: AutopilotBody,
    existing?: Autopilot | null,
  ): { ok: true; item: Autopilot } | { ok: false; status: number; error: string } {
    const name = clipTitle(String(body.name ?? existing?.name ?? "").trim(), "Autopilot", 120);
    if (!name.trim()) return { ok: false, status: 400, error: "name_required" };
    const cronExpression = String(body.cronExpression ?? existing?.cronExpression ?? "").trim();
    const cronOk = validateCronExpression(cronExpression);
    if (!cronOk.ok) return { ok: false, status: 400, error: `invalid_cron:${cronOk.error}` };

    const actionRaw = String(body.action ?? existing?.action ?? "skill_task").trim();
    const action = actionRaw === "workflow_run" ? "workflow_run" : "skill_task";
    const executionMode =
      String(body.executionMode ?? existing?.executionMode ?? "run_only").trim() === "create_work_item"
        ? "create_work_item"
        : "run_only";
    const statusRaw = String(body.status ?? existing?.status ?? "active").trim();
    const status =
      statusRaw === "paused" ? "paused" : statusRaw === "archived" ? "archived" : "active";
    const skill = String(body.skill ?? existing?.skill ?? "default").trim() || "default";
    const workflowId = String(body.workflowId ?? existing?.workflowId ?? "").trim();
    if (action === "workflow_run") {
      if (!workflowId) return { ok: false, status: 400, error: "workflow_id_required" };
      if (!getWorkflow(dataDir, workflowId)) {
        return { ok: false, status: 400, error: "workflow_not_found" };
      }
    }
    const projectDir = path.resolve(
      String(body.projectDir ?? existing?.projectDir ?? "").trim() || process.cwd(),
    );
    const now = Date.now();
    const webhookEnabled =
      typeof body.webhookEnabled === "boolean"
        ? body.webhookEnabled
        : Boolean(existing?.webhookEnabled);
    let webhookToken = existing?.webhookToken || "";
    let webhookSecret = existing?.webhookSecret || "";
    if (!webhookToken) webhookToken = newAutopilotWebhookToken();
    if (webhookEnabled && !webhookSecret) webhookSecret = newAutopilotWebhookSecret();
    const item: Autopilot = {
      id: existing?.id || newAutopilotId(),
      name,
      runbook: clipPrompt(String(body.runbook ?? existing?.runbook ?? "").trim()),
      status,
      action,
      executionMode,
      skill,
      workflowId: action === "workflow_run" ? workflowId : "",
      projectDir,
      agentProfileId: String(body.agentProfileId ?? existing?.agentProfileId ?? "").trim(),
      model: String(body.model ?? existing?.model ?? "").trim(),
      titleTemplate: String(body.titleTemplate ?? existing?.titleTemplate ?? "{{name}} · {{time}}").trim(),
      cronExpression,
      timezone: String(body.timezone ?? existing?.timezone ?? "local").trim() || "local",
      nextRunAt: existing?.nextRunAt || 0,
      lastRunAt: existing?.lastRunAt || 0,
      concurrencyPolicy:
        String(body.concurrencyPolicy ?? existing?.concurrencyPolicy ?? "skip").trim() === "allow"
          ? "allow"
          : "skip",
      webhookEnabled,
      webhookToken,
      webhookSecret,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    return { ok: true, item };
  }

  app.get<{ Querystring: { revealSecrets?: string } }>("/api/autopilots", async (req) => {
    const reveal = req.query.revealSecrets === "1" || req.query.revealSecrets === "true";
    return db.listAutopilots(200).map((ap) => summarizeAutopilot(ap, { revealSecrets: reveal }));
  });

  app.get<{ Params: { id: string }; Querystring: { revealSecrets?: string } }>(
    "/api/autopilots/:id",
    async (req, reply) => {
      const ap = db.getAutopilot(req.params.id);
      if (!ap || ap.status === "archived") return reply.code(404).send({ error: "not_found" });
      const reveal = req.query.revealSecrets === "1" || req.query.revealSecrets === "true";
      return summarizeAutopilot(ap, { revealSecrets: reveal });
    },
  );

  app.post<{ Body: AutopilotBody }>("/api/autopilots", async (req, reply) => {
    const built = buildAutopilotFromBody(req.body || {});
    if (!built.ok) return reply.code(built.status).send({ error: built.error });
    let item = built.item;
    if (item.status === "active") item = advanceAutopilotSchedule(db, item, Date.now());
    else {
      item = { ...item, nextRunAt: 0 };
      db.upsertAutopilot(item);
    }
    return summarizeAutopilot(item);
  });

  app.put<{ Params: { id: string }; Body: AutopilotBody }>("/api/autopilots/:id", async (req, reply) => {
    const current = db.getAutopilot(req.params.id);
    if (!current || current.status === "archived") return reply.code(404).send({ error: "not_found" });
    const built = buildAutopilotFromBody(req.body || {}, current);
    if (!built.ok) return reply.code(built.status).send({ error: built.error });
    let item = built.item;
    const cronChanged = item.cronExpression !== current.cronExpression;
    const resumed = current.status !== "active" && item.status === "active";
    if (item.status === "active" && (cronChanged || resumed || !item.nextRunAt)) {
      item = advanceAutopilotSchedule(db, item, Date.now());
    } else if (item.status !== "active") {
      item = { ...item, nextRunAt: 0 };
      db.upsertAutopilot(item);
    } else {
      db.upsertAutopilot(item);
    }
    return summarizeAutopilot(item);
  });

  app.post<{ Params: { id: string } }>("/api/autopilots/:id/pause", async (req, reply) => {
    const current = db.getAutopilot(req.params.id);
    if (!current || current.status === "archived") return reply.code(404).send({ error: "not_found" });
    const next: Autopilot = {
      ...current,
      status: "paused",
      nextRunAt: 0,
      updatedAt: Date.now(),
    };
    db.upsertAutopilot(next);
    return summarizeAutopilot(next);
  });

  app.post<{ Params: { id: string } }>("/api/autopilots/:id/resume", async (req, reply) => {
    const current = db.getAutopilot(req.params.id);
    if (!current || current.status === "archived") return reply.code(404).send({ error: "not_found" });
    const next = advanceAutopilotSchedule(
      db,
      { ...current, status: "active", updatedAt: Date.now() },
      Date.now(),
    );
    return summarizeAutopilot(next);
  });

  app.delete<{ Params: { id: string } }>("/api/autopilots/:id", async (req, reply) => {
    if (!db.deleteAutopilot(req.params.id)) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/autopilots/:id/run", async (req, reply) => {
    const current = db.getAutopilot(req.params.id);
    if (!current || current.status === "archived") return reply.code(404).send({ error: "not_found" });
    try {
      const result = await dispatchAutopilot(db, runnerOpts, dataDir, current, {
        source: "manual",
        plannedAt: 0,
      });
      return { ok: true, run: result.run, autopilot: summarizeAutopilot(result.autopilot) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "duplicate_or_busy") return reply.code(409).send({ error: "busy" });
      return reply.code(500).send({ error: msg });
    }
  });

  app.get<{ Params: { id: string } }>("/api/autopilots/:id/runs", async (req, reply) => {
    const current = db.getAutopilot(req.params.id);
    if (!current || current.status === "archived") return reply.code(404).send({ error: "not_found" });
    return db.listAutopilotRuns(current.id, 50);
  });

  app.post<{ Params: { id: string }; Body: { rotateSecret?: boolean } }>(
    "/api/autopilots/:id/webhook/rotate",
    async (req, reply) => {
      const current = db.getAutopilot(req.params.id);
      if (!current || current.status === "archived") return reply.code(404).send({ error: "not_found" });
      const rotateSecret = req.body?.rotateSecret !== false;
      const next: Autopilot = {
        ...current,
        webhookToken: newAutopilotWebhookToken(),
        webhookSecret: rotateSecret ? newAutopilotWebhookSecret() : current.webhookSecret,
        updatedAt: Date.now(),
      };
      if (next.webhookEnabled && !next.webhookSecret) {
        next.webhookSecret = newAutopilotWebhookSecret();
      }
      db.upsertAutopilot(next);
      return summarizeAutopilot(next, { revealSecrets: true });
    },
  );

  /** Public ingress: token in path is the credential. Optional HMAC when secret set. */
  app.post<{ Params: { token: string } }>("/api/webhooks/autopilots/:token", async (req, reply) => {
    const token = String(req.params.token || "").trim();
    const ap = db.getAutopilotByWebhookToken(token);
    if (!ap) return reply.code(404).send({ error: "not_found" });

    const rawBody = String((req as { rawBody?: string }).rawBody ?? "");
    if (Buffer.byteLength(rawBody, "utf8") > AUTOPILOT_WEBHOOK_MAX_BYTES) {
      return reply.code(413).send({ error: "payload_too_large" });
    }

    const headers = req.headers as Record<string, unknown>;
    if (ap.webhookSecret) {
      const sig = headerString(headers, "x-hub-signature-256");
      if (!verifyHubSignature256(rawBody || JSON.stringify(req.body ?? {}), ap.webhookSecret, sig)) {
        db.tryInsertWebhookDelivery({
          autopilotId: ap.id,
          deliveryKey: resolveWebhookDeliveryKey(headers) || `reject_${Date.now()}`,
          status: "rejected",
        });
        return reply.code(401).send({ error: "invalid_signature" });
      }
    }

    const deliveryKey = resolveWebhookDeliveryKey(headers);
    const admitted = db.tryInsertWebhookDelivery({
      autopilotId: ap.id,
      deliveryKey,
      status: "accepted",
    });
    if (admitted.duplicate) {
      const prev = db.findWebhookDelivery(ap.id, deliveryKey);
      return {
        status: "duplicate",
        deliveryId: admitted.id,
        runId: prev?.runId || "",
      };
    }

    try {
      const result = await dispatchAutopilot(db, runnerOpts, dataDir, ap, {
        source: "webhook",
        plannedAt: 0,
        promptExtra: formatWebhookPayloadBlock(req.body ?? {}),
      });
      db.updateWebhookDelivery(admitted.id, {
        runId: result.run.id,
        status: result.run.status === "skipped" ? "skipped" : "accepted",
      });
      return {
        status: result.run.status === "skipped" ? "skipped" : "accepted",
        deliveryId: admitted.id,
        runId: result.run.id,
        taskId: result.run.taskId || "",
        workflowRunId: result.run.workflowRunId || "",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.updateWebhookDelivery(admitted.id, { status: "failed" });
      if (msg === "duplicate_or_busy") {
        return reply.code(409).send({ error: "busy", deliveryId: admitted.id });
      }
      return reply.code(500).send({ error: msg, deliveryId: admitted.id });
    }
  });

  app.post<{ Body: { expression?: string; count?: number } }>(
    "/api/autopilots/cron/preview",
    async (req, reply) => {
      const expression = String(req.body?.expression || "").trim();
      const cronOk = validateCronExpression(expression);
      if (!cronOk.ok) return reply.code(400).send({ error: `invalid_cron:${cronOk.error}` });
      const count = Math.min(12, Math.max(1, Number(req.body?.count) || 5));
      try {
        return { ok: true, expression, next: previewCronOccurrences(expression, count) };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    },
  );

  app.post("/api/shutdown", async (_req, reply) => {
    void reply.send({ ok: true });
    setImmediate(async () => {
      try {
        stopTaskWatchdog();
        stopLocalExecutor();
        stopAutopilotScheduler();
        await app.close();
      } finally {
        process.exit(0);
      }
    });
  });

  return { app, db, settings, dataDir, runnerOpts };
}

export async function startServer(opts: ServerOptions = {}) {
  const host = opts.host ?? process.env.AD_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.AD_PORT ?? 19877);
  const { app, db, dataDir, runnerOpts } = await createServer(opts);
  await app.listen({ host, port });
  startAutopilotScheduler(db, runnerOpts, dataDir);

  // Interactive DingTalk cards: one Stream connection with the web process.
  // Config from env AD_DINGTALK_* (preferred) or Settings.dingtalk in ~/.agent-desk.
  const dtCfg = resolveDingTalkConfig();
  if (dtCfg.cardTemplateId && dtCfg.appKey && dtCfg.appSecret) {
    const runnerOpts = { db, settings: db.getSettings(), dataDir };
    try {
      await startDingTalkCardStream({
        onCardCallback: createDingTalkGateResumeHandler({
          resume: async (taskId, reply) => {
            const task = db.getTask(taskId);
            if (!task) return { ok: false, message: `task not found: ${taskId}` };
            if (task.status !== "awaiting" && task.status !== "created") {
              return {
                ok: false,
                message: `task status is ${task.status}, expected awaiting`,
              };
            }
            const updated = await resumeTask(runnerOpts, taskId, reply);
            if (task.workflowRunId && updated?.status === "stopped") {
              try {
                stopRun(dataDir, runnerOpts, task.workflowRunId);
              } catch {
                /* ignore */
              }
            }
            return { ok: true, message: `status=${updated?.status ?? "?"}` };
          },
        }),
      });
      console.log(
        "[dingtalk-stream] interactive gate callbacks enabled (card template configured)",
      );
    } catch (err) {
      console.error(
        "[dingtalk-stream] failed to start:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

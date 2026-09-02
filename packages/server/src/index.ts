import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { clipPrompt, clipTitle, newAgentId, parseGate, type AgentProfile } from "@agent-desk/core";
import { defaultDataDir, openDb } from "@agent-desk/db";
import { registerClaudeBackend } from "@agent-desk/provider-agent-claude";
import { registerCodexBackend } from "@agent-desk/provider-agent-codex";
import { registerCursorBackend } from "@agent-desk/provider-agent-cursor";
import { getAgentBackend, listInstalledAgentProviders, reconcileModelForAgent } from "@agent-desk/provider-agent";
import { getIssueProvider, listIssueProviders } from "@agent-desk/provider-issue";
import { registerGitHubIssueProvider, ensureIssueWorkspace, setGitHubSettingsSource } from "@agent-desk/provider-issue-github";
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
  createTask,
  enqueueStartTask,
  isTaskRunning,
  resumeTask,
  startTask,
  stopTask,
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
  DEFAULT_NOTIFY_WEBHOOK_SETTINGS,
  type DingTalkSettings,
  type GitHubSettings,
  type NotifyWebhookSettings,
  type Settings,
  type Task,
} from "@agent-desk/core";
import { browse as fsBrowse, mkdir as fsMkdir } from "./fs-browser.js";

/** Mask stored secrets in API responses (UI shows placeholder; blank save keeps old). */
const SECRET_MASK = "********";

function redactSettings(settings: Settings): Settings {
  const dt = { ...settings.dingtalk };
  if (dt.secret) dt.secret = SECRET_MASK;
  if (dt.appSecret) dt.appSecret = SECRET_MASK;
  const gh = { ...settings.github };
  if (gh.token) gh.token = SECRET_MASK;
  return { ...settings, dingtalk: dt, github: gh };
}

function keepSecret(incoming: string | undefined, current: string): string {
  const v = (incoming ?? "").trim();
  if (!v || v === SECRET_MASK) return current;
  return v;
}

function isTaskStreamLive(task: Task): boolean {
  return task.status === "running" || task.status === "awaiting" || isTaskRunning(task.id);
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

export async function createServer(opts: ServerOptions = {}) {
  registerProviders();
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
  setNotifyWebhookSettingsSource(() => db.getSettings());
  const settings = db.getSettings();
  const runnerOpts = { db, settings, dataDir };
  registerWorkflowHooks(dataDir, runnerOpts);

  const app = Fastify({ logger: true });

  await app.register(fastifyStatic, {
    root: uiPublicDir(),
    prefix: "/static/",
  });

  app.get("/", async (_req, reply) => {
    return reply.sendFile("index.html");
  });

  app.get("/api/health", async () => ({ ok: true, version: "0.2.0" }));

  app.get("/api/dashboard", async () => {
    const tasks = db.listTasks(300);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const awaiting = tasks.filter((t) => t.status === "awaiting");
    const active = tasks.filter((t) => t.status === "running" || t.status === "created");
    const doneWeek = tasks.filter((t) => t.status === "done" && Number(t.updatedAt) >= weekAgo);
    const failedRecent = tasks.filter((t) => t.status === "failed").slice(0, 12);

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

    let openIssues: Array<{
      code: string;
      title: string;
      status: string;
      severity: string;
      projectDir: string;
      url?: string;
      updatedAt: number;
    }> = [];
    let openIssueCount = 0;
    try {
      const issueProviderId = db.getSettings().providers.issue || "manual";
      const provider = getIssueProvider(issueProviderId);
      const issues = await provider.listIssues({ state: "open", limit: 30 });
      openIssueCount = issues.length;
      openIssues = issues.slice(0, 12).map((i) => ({
        code: i.code,
        title: i.title,
        status: i.status,
        severity: i.severity,
        projectDir: i.projectDir,
        url: i.url,
        updatedAt: i.updatedAt,
      }));
    } catch {
      openIssues = [];
      openIssueCount = 0;
    }

    return {
      ok: true,
      awaiting_count: awaiting.length,
      active_count: active.length,
      done_week_count: doneWeek.length,
      failed_count: tasks.filter((t) => t.status === "failed").length,
      open_issue_count: openIssueCount,
      awaiting_tasks: awaiting.slice(0, 12).map(summarize),
      active_tasks: active.slice(0, 12).map(summarize),
      failed_tasks: failedRecent.map(summarize),
      open_issues: openIssues,
    };
  });

  app.get("/api/inbox", async () => {
    const tasks = db
      .listTasks(300)
      .filter((t) => t.status === "awaiting")
      .sort((a, b) => Number(b.lastActivityAt || b.updatedAt) - Number(a.lastActivityAt || a.updatedAt));

    const items = tasks.map((t) => {
      const gate = parseGate(t.result || "");
      return {
        taskId: t.id,
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

  app.get("/api/agent-providers", async () => listInstalledAgentProviders());

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

  app.get("/api/tasks", async () => db.listTasks());

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    return task;
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
    if (!["created", "failed", "stopped"].includes(task.status)) {
      return reply.code(409).send({ error: "not_startable", status: task.status, task });
    }
    const updated = await startTask(runnerOpts, task.id);
    return updated;
  });

  async function handleResume(taskId: string, replyText: string, model?: string) {
    const task = db.getTask(taskId);
    if (!task) return { ok: false as const, error: "not_found" as const };
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
      if (!result.ok) return reply.code(404).send({ error: "not_found" });
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
    stopTask(req.params.id);
    if (task.workflowRunId) {
      try {
        stopRun(dataDir, runnerOpts, task.workflowRunId);
      } catch {
        // ignore
      }
    } else {
      db.updateTask(req.params.id, { status: "stopped" });
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

  app.post("/api/shutdown", async (_req, reply) => {
    void reply.send({ ok: true });
    setImmediate(async () => {
      try {
        await app.close();
      } finally {
        process.exit(0);
      }
    });
  });

  return { app, db, settings, dataDir };
}

export async function startServer(opts: ServerOptions = {}) {
  const host = opts.host ?? process.env.AD_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.AD_PORT ?? 19877);
  const { app, db, dataDir } = await createServer(opts);
  await app.listen({ host, port });

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

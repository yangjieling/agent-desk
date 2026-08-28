import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { clipPrompt, clipTitle } from "@agent-desk/core";
import { defaultDataDir, openDb } from "@agent-desk/db";
import { registerClaudeBackend } from "@agent-desk/provider-agent-claude";
import { getIssueProvider, listIssueProviders } from "@agent-desk/provider-issue";
import { registerGitHubIssueProvider } from "@agent-desk/provider-issue-github";
import { registerManualIssueProvider } from "@agent-desk/provider-issue-manual";
import { registerDingTalkNotifyProvider } from "@agent-desk/provider-notify-dingtalk";
import { registerFeishuNotifyProvider } from "@agent-desk/provider-notify-feishu";
import { registerWebhookNotifyProvider } from "@agent-desk/provider-notify-webhook";
import {
  createTask,
  resumeTask,
  startTask,
  stopTask,
} from "@agent-desk/runner";
import {
  continueRun,
  getRun,
  getWorkflow,
  listRuns,
  listWorkflows,
  registerWorkflowHooks,
  startRun,
  stopRun,
} from "@agent-desk/workflow";

export interface ServerOptions {
  host?: string;
  port?: number;
  dataDir?: string;
}

function registerProviders(): void {
  registerClaudeBackend();
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
  const db = openDb(dataDir);
  const settings = db.getSettings();
  const runnerOpts = { db, settings };
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

  app.get("/api/settings", async () => db.getSettings());

  app.put<{ Body: Partial<typeof settings> }>("/api/settings", async (req) => {
    const next = { ...db.getSettings(), ...req.body };
    db.saveSettings(next);
    return next;
  });

  app.get("/api/issue-providers", async () =>
    listIssueProviders().map((p) => ({ id: p.id, displayName: p.displayName })),
  );

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
            ? "Set AD_GITHUB_REPO=owner/repo and AD_GITHUB_TOKEN, then restart"
            : undefined,
      });
    }
    const stateRaw = (req.query.state || "open").trim();
    const state =
      stateRaw === "closed" || stateRaw === "all" ? stateRaw : "open";
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

  app.post<{ Body: { title?: string; prompt?: string; projectDir?: string; issueCode?: string } }>(
    "/api/tasks",
    async (req, reply) => {
      const title = clipTitle(req.body.title ?? "Untitled task");
      const prompt = clipPrompt(req.body.prompt ?? "");
      if (!prompt.trim()) return reply.code(400).send({ error: "prompt_required" });

      const task = createTask(
        {
          title,
          prompt,
          projectDir: req.body.projectDir,
          issueCode: req.body.issueCode,
        },
        settings,
      );
      db.upsertTask(task);
      void startTask(runnerOpts, task.id);
      return task;
    },
  );

  async function handleResume(taskId: string, replyText: string) {
    const task = db.getTask(taskId);
    if (!task) return { ok: false as const, error: "not_found" as const };
    const updated = await resumeTask(runnerOpts, taskId, replyText);
    if (task.workflowRunId && updated?.status === "stopped") {
      try {
        stopRun(dataDir, runnerOpts, task.workflowRunId);
      } catch {
        // ignore
      }
    }
    return { ok: true as const, task: updated };
  }

  app.post<{ Params: { id: string }; Body: { reply?: string } }>(
    "/api/tasks/:id/resume",
    async (req, reply) => {
      const result = await handleResume(req.params.id, req.body.reply ?? "继续");
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
    Params: { id: string };
    Body: { title?: string; prompt?: string; projectDir?: string; issueCode?: string };
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
  const { app } = await createServer(opts);
  await app.listen({ host, port });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

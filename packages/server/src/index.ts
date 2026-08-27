import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { clipPrompt, clipTitle } from "@agent-desk/core";
import { defaultDataDir, openDb } from "@agent-desk/db";
import { registerClaudeBackend } from "@agent-desk/provider-agent-claude";
import { registerManualIssueProvider } from "@agent-desk/provider-issue-manual";
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
  registerWebhookNotifyProvider();
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

  app.post<{ Params: { id: string }; Body: { reply?: string } }>(
    "/api/tasks/:id/resume",
    async (req, reply) => {
      const task = db.getTask(req.params.id);
      if (!task) return reply.code(404).send({ error: "not_found" });
      const replyText = req.body.reply ?? "继续";
      const updated = await resumeTask(runnerOpts, req.params.id, replyText);
      if (task.workflowRunId && updated?.status === "stopped") {
        try {
          stopRun(dataDir, runnerOpts, task.workflowRunId);
        } catch {
          // ignore
        }
      }
      return updated;
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

  return { app, db, settings, dataDir };
}

export async function startServer(opts: ServerOptions = {}) {
  const host = opts.host ?? process.env.AD_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.AD_PORT ?? 19876);
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

import Fastify from "fastify";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { clipPrompt, clipTitle } from "@agent-desk/core";
import { openDb } from "@agent-desk/db";
import { registerClaudeBackend } from "@agent-desk/provider-agent-claude";
import { registerManualIssueProvider } from "@agent-desk/provider-issue-manual";
import { registerWebhookNotifyProvider } from "@agent-desk/provider-notify-webhook";
import {
  createTask,
  resumeTask,
  startTask,
  stopTask,
} from "@agent-desk/runner";

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

export async function createServer(opts: ServerOptions = {}) {
  registerProviders();
  const db = openDb(opts.dataDir);
  const settings = db.getSettings();
  const app = Fastify({ logger: true });

  app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));

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
      void startTask({ db, settings }, task.id);
      return task;
    },
  );

  app.post<{ Params: { id: string }; Body: { reply?: string } }>(
    "/api/tasks/:id/resume",
    async (req, reply) => {
      const task = db.getTask(req.params.id);
      if (!task) return reply.code(404).send({ error: "not_found" });
      const replyText = req.body.reply ?? "继续";
      const updated = await resumeTask({ db, settings }, req.params.id, replyText);
      return updated;
    },
  );

  app.post<{ Params: { id: string } }>("/api/tasks/:id/stop", async (req, reply) => {
    const task = db.getTask(req.params.id);
    if (!task) return reply.code(404).send({ error: "not_found" });
    stopTask(req.params.id);
    const updated = db.updateTask(req.params.id, { status: "stopped" });
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    stopTask(req.params.id);
    const ok = db.deleteTask(req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  return { app, db, settings };
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

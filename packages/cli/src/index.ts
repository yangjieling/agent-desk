#!/usr/bin/env node
import { Command } from "commander";
import { clipPrompt, clipTitle } from "@agent-desk/core";
import { defaultDataDir, openDb } from "@agent-desk/db";
import { registerClaudeBackend } from "@agent-desk/provider-agent-claude";
import { registerManualIssueProvider } from "@agent-desk/provider-issue-manual";
import { registerWebhookNotifyProvider } from "@agent-desk/provider-notify-webhook";
import { createTask, startTask } from "@agent-desk/runner";
import { startServer } from "@agent-desk/server";
import { listWorkflows } from "@agent-desk/workflow";

function registerProviders(): void {
  registerClaudeBackend();
  registerManualIssueProvider();
  registerWebhookNotifyProvider();
}

const program = new Command();

program
  .name("agent-desk")
  .description("Open-source agent task harness")
  .version("0.1.0");

program
  .command("web")
  .description("Start local web API server + UI")
  .option("-p, --port <port>", "port", "19876")
  .option("-H, --host <host>", "host", "127.0.0.1")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action(async (opts: { port: string; host: string; dataDir: string }) => {
    registerProviders();
    await startServer({
      host: opts.host,
      port: Number(opts.port),
      dataDir: opts.dataDir,
    });
    console.log(`agent-desk listening on http://${opts.host}:${opts.port}`);
  });

const workflows = program.command("workflows").description("Manage workflows");

workflows
  .command("list")
  .description("List workflow templates")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action((opts: { dataDir: string }) => {
    const rows = listWorkflows(opts.dataDir);
    if (!rows.length) {
      console.log("No workflows.");
      return;
    }
    for (const w of rows) {
      console.log(`${w.id}\t${w.mode}\t${w.nodes.length} nodes\t${w.name}`);
    }
  });

workflows
  .command("run <workflowId>")
  .description("Start a workflow run")
  .option("-t, --title <title>", "run title")
  .option("-p, --prompt <prompt>", "input prompt")
  .option("--project-dir <dir>", "project directory", process.cwd())
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action(async (workflowId: string, opts: { title?: string; prompt?: string; projectDir: string; dataDir: string }) => {
    registerProviders();
    const db = openDb(opts.dataDir);
    const settings = db.getSettings();
    const { registerWorkflowHooks, startRun } = await import("@agent-desk/workflow");
    const runnerOpts = { db, settings };
    registerWorkflowHooks(opts.dataDir, runnerOpts);
    const run = startRun(opts.dataDir, runnerOpts, {
      workflowId,
      title: opts.title,
      inputPrompt: opts.prompt,
      projectDir: opts.projectDir,
    });
    console.log(run.id);
    if (run.parentTaskId) console.log(`task: ${run.parentTaskId}`);
  });

const tasks = program.command("tasks").description("Manage tasks");

tasks
  .command("list")
  .description("List recent tasks")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action((opts: { dataDir: string }) => {
    registerProviders();
    const db = openDb(opts.dataDir);
    const rows = db.listTasks();
    if (rows.length === 0) {
      console.log("No tasks.");
      return;
    }
    for (const t of rows) {
      console.log(`${t.id}\t${t.status}\t${t.title}`);
    }
  });

tasks
  .command("create")
  .description("Create and start a task")
  .requiredOption("-t, --title <title>", "task title")
  .requiredOption("-p, --prompt <prompt>", "task prompt")
  .option("--project-dir <dir>", "project directory", process.cwd())
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action(async (opts: { title: string; prompt: string; projectDir: string; dataDir: string }) => {
    registerProviders();
    const db = openDb(opts.dataDir);
    const settings = db.getSettings();
    const task = createTask(
      {
        title: clipTitle(opts.title),
        prompt: clipPrompt(opts.prompt),
        projectDir: opts.projectDir,
      },
      settings,
    );
    db.upsertTask(task);
    await startTask({ db, settings }, task.id);
    console.log(task.id);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

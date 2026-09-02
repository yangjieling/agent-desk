#!/usr/bin/env node
import { Command } from "commander";
import { clipPrompt, clipTitle } from "@agent-desk/core";
import { defaultDataDir, openDb } from "@agent-desk/db";
import { registerClaudeBackend } from "@agent-desk/provider-agent-claude";
import { registerCodexBackend } from "@agent-desk/provider-agent-codex";
import { registerCursorBackend } from "@agent-desk/provider-agent-cursor";
import { getIssueProvider, listIssueProviders } from "@agent-desk/provider-issue";
import { registerGitHubIssueProvider, setGitHubSettingsSource } from "@agent-desk/provider-issue-github";
import { registerManualIssueProvider } from "@agent-desk/provider-issue-manual";
import {
  createDingTalkGateResumeHandler,
  registerDingTalkNotifyProvider,
  setDingTalkSettingsSource,
  startDingTalkCardStream,
} from "@agent-desk/provider-notify-dingtalk";
import { registerFeishuNotifyProvider } from "@agent-desk/provider-notify-feishu";
import { getNotifyProvider, listNotifyProviders } from "@agent-desk/provider-notify";
import { registerWebhookNotifyProvider } from "@agent-desk/provider-notify-webhook";
import { createTask, resumeTask, startTask } from "@agent-desk/runner";
import { startServer } from "@agent-desk/server";
import { listSkillSummaries, syncBundledSkills, seedUserSkills, uninstallUserSkill } from "@agent-desk/skills";
import { listWorkflows } from "@agent-desk/workflow";
import {
  registerForegroundLifecycle,
  startBackground,
  stopWeb,
} from "./web-daemon.js";

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

function wireSettingsSources(dataDir: string) {
  const db = openDb(dataDir);
  setDingTalkSettingsSource(() => db.getSettings());
  setGitHubSettingsSource(() => db.getSettings());
  return db;
}

function activeIssueProviderId(dataDir: string): string {
  const settings = openDb(dataDir).getSettings();
  return settings.providers.issue || "manual";
}

const program = new Command();

program
  .name("oh")
  .description("Open-source agent task harness")
  .version("0.1.0");

program
  .command("web")
  .description("Start local web API server + UI (default: background)")
  .option("-p, --port <port>", "port", "19877")
  .option("-H, --host <host>", "host", "127.0.0.1")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .option("--foreground", "run in foreground and keep this terminal")
  .option("--stop", "stop background web server")
  .option("--open", "open browser after start")
  .action(async (opts: {
    port: string;
    host: string;
    dataDir: string;
    foreground?: boolean;
    stop?: boolean;
    open?: boolean;
  }) => {
    if (opts.stop) {
      const code = await stopWeb({
        host: opts.host,
        port: Number(opts.port),
        dataDir: opts.dataDir,
      });
      process.exit(code);
    }

    if (opts.foreground) {
      registerProviders();
      registerForegroundLifecycle(opts.dataDir);
      const { openBrowser } = await import("./web-daemon.js");
      await startServer({
        host: opts.host,
        port: Number(opts.port),
        dataDir: opts.dataDir,
      });
      const url = `http://${opts.host}:${opts.port}/`;
      console.log(`oh web 已启动: ${url}`);
      if (opts.open) await openBrowser(url);
      return;
    }

    const code = await startBackground({
      host: opts.host,
      port: Number(opts.port),
      dataDir: opts.dataDir,
      openBrowser: opts.open !== false,
    });
    process.exit(code);
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
  .option("--skill <id>", "skill id (SKILL.md pack)", "default")
  .option("--agent <id>", "agent profile id")
  .option("--project-dir <dir>", "project directory", process.cwd())
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action(async (opts: {
    title: string;
    prompt: string;
    skill: string;
    agent?: string;
    projectDir: string;
    dataDir: string;
  }) => {
    registerProviders();
    const db = openDb(opts.dataDir);
    const settings = db.getSettings();
    const runnerOpts = { db, settings };
    const task = createTask(
      {
        title: clipTitle(opts.title),
        prompt: clipPrompt(opts.prompt),
        projectDir: opts.projectDir,
        skill: opts.skill,
        agentProfileId: opts.agent,
      },
      settings,
      runnerOpts,
    );
    db.upsertTask(task);
    await startTask(runnerOpts, task.id);
    console.log(task.id);
  });

const skills = program.command("skills").description("List / sync bundled skills");

skills
  .command("list")
  .description("List skills from project / user / bundled roots")
  .option("--cwd <dir>", "project directory for discovery", process.cwd())
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action((opts: { cwd: string; dataDir: string }) => {
    const userDir = `${opts.dataDir.replace(/\/$/, "")}/skills`;
    const rows = listSkillSummaries({ cwd: opts.cwd, userDir });
    if (!rows.length) {
      console.log("No skills found.");
      return;
    }
    for (const s of rows) {
      const kind = s.managed || s.source === "bundled" ? "builtin" : s.source;
      const flag = s.removable ? "removable" : s.managed ? "managed" : "";
      const ver = s.version ? `v${s.version}` : "";
      const desc = s.description ? `\t${s.description}` : "";
      console.log([s.id, kind, ver, flag].filter(Boolean).join("\t") + desc);
    }
  });

skills
  .command("sync")
  .description("Install/update bundled skills into ~/.agent-desk/skills")
  .option("--force", "overwrite managed installs even if up to date")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action((opts: { force?: boolean; dataDir: string }) => {
    const userDir = `${opts.dataDir.replace(/\/$/, "")}/skills`;
    const sync = syncBundledSkills({ force: !!opts.force, userDir });
    const seed = seedUserSkills({ userDir });
    console.log(`builtin bundle ${sync.bundleVersion}`);
    if (sync.installed.length) console.log(`installed: ${sync.installed.join(", ")}`);
    if (sync.updated.length) console.log(`updated:   ${sync.updated.join(", ")}`);
    if (sync.skipped.length) console.log(`skipped:   ${sync.skipped.join(", ")}`);
    for (const e of sync.errors) console.error(`error ${e.id}: ${e.error}`);
    console.log(`seeds ${seed.seedVersion}`);
    if (seed.seeded.length) console.log(`seeded:    ${seed.seeded.join(", ")}`);
    if (seed.demoted.length) console.log(`demoted:   ${seed.demoted.join(", ")} (now user)`);
    if (seed.skipped.length) console.log(`seed-skip: ${seed.skipped.join(", ")}`);
    for (const e of seed.errors) console.error(`seed-error ${e.id}: ${e.error}`);
    if (sync.errors.length || seed.errors.length) process.exitCode = 1;
  });

skills
  .command("uninstall <id>")
  .description("Uninstall a user-authored skill (built-in managed skills cannot be removed)")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action((id: string, opts: { dataDir: string }) => {
    const userDir = `${opts.dataDir.replace(/\/$/, "")}/skills`;
    try {
      const r = uninstallUserSkill(id, { userDir });
      console.log(`removed ${r.id}\n${r.removed}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    }
  });

const issues = program.command("issues").description("List / show bugs via issue provider");

issues
  .command("providers")
  .description("List registered issue providers")
  .action(() => {
    registerProviders();
    for (const p of listIssueProviders()) {
      console.log(`${p.id}\t${p.displayName}`);
    }
  });

issues
  .command("list")
  .description("List issues from the configured provider")
  .option("--state <state>", "open | closed | all", "open")
  .option("--label <label>", "filter by label (repeatable)", (v: string, acc: string[]) => {
    acc.push(v);
    return acc;
  }, [] as string[])
  .option("--limit <n>", "max issues", "30")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action(async (opts: {
    state: string;
    label: string[];
    limit: string;
    dataDir: string;
  }) => {
    registerProviders();
    wireSettingsSources(opts.dataDir);
    const id = activeIssueProviderId(opts.dataDir);
    const provider = getIssueProvider(id);
    const state = opts.state === "closed" || opts.state === "all" ? opts.state : "open";
    const rows = await provider.listIssues({
      state,
      labels: opts.label.length ? opts.label : undefined,
      limit: Number(opts.limit) || 30,
    });
    if (!rows.length) {
      console.log(`No issues (${id}).`);
      return;
    }
    for (const r of rows) {
      const sev = r.severity ? `\t${r.severity}` : "";
      console.log(`${r.code}\t${r.status}${sev}\t${r.title}`);
    }
  });

issues
  .command("show <code>")
  .description("Show one issue (e.g. #12)")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action(async (code: string, opts: { dataDir: string }) => {
    registerProviders();
    wireSettingsSources(opts.dataDir);
    const id = activeIssueProviderId(opts.dataDir);
    const provider = getIssueProvider(id);
    const issue = await provider.getIssue(code);
    if (!issue) {
      console.error(`Issue not found: ${code} (${id})`);
      process.exit(1);
    }
    console.log(JSON.stringify(issue, null, 2));
  });

const notify = program.command("notify").description("Notify provider helpers");

notify
  .command("providers")
  .description("List registered notify providers")
  .action(() => {
    registerProviders();
    for (const p of listNotifyProviders()) {
      console.log(`${p.id}\t${p.displayName}`);
    }
  });

notify
  .command("test")
  .description("Send a test gate card via the configured notify provider")
  .option("--provider <id>", "override providers.notify (e.g. dingtalk)")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .action(async (opts: { provider?: string; dataDir: string }) => {
    registerProviders();
    const db = wireSettingsSources(opts.dataDir);
    const settings = db.getSettings();
    const id = (opts.provider || settings.providers.notify || "webhook").trim();
    const provider = getNotifyProvider(id);
    const webUrl = `${settings.webBaseUrl}/?task=notify-test`;
    // Unique body each run — DingTalk work-notify clients often suppress
    // duplicate cards with identical title/markdown.
    const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
    await provider.sendGate({
      taskId: "notify-test",
      title: `oh notify test · ${stamp}`,
      gateHeading: `这是一条测试闸门通知（${stamp}）`,
      choices: [
        { label: "确认", value: "确认" },
        { label: "取消", value: "取消" },
      ],
      webUrl,
    });
    console.log(`sent gate test via ${provider.id} (${provider.displayName}) at ${stamp}`);
  });

notify
  .command("dingtalk-stream")
  .description(
    "Listen for DingTalk interactive-card Stream callbacks and resume awaiting tasks",
  )
  .option("--debug", "verbose Stream client logs")
  .option("--data-dir <dir>", "data directory", defaultDataDir())
  .option("--probe-only", "only log/ACK callbacks; do not resume tasks")
  .action(async (opts: { debug?: boolean; dataDir: string; probeOnly?: boolean }) => {
    const db = wireSettingsSources(opts.dataDir);
    const settings = db.getSettings();
    const runnerOpts = { db, settings };

    const onCardCallback = opts.probeOnly
      ? (event: { actionIds: string[]; params: Record<string, unknown>; outTrackId?: string }) => {
          const stamp = new Date().toLocaleString("zh-CN", { hour12: false });
          return {
            cardUpdateOptions: { updateCardDataByKey: true },
            cardData: {
              cardParamMap: {
                description: [
                  `probe-only（${stamp}）`,
                  `actionIds: ${event.actionIds.join(",") || "(none)"}`,
                  `params: ${JSON.stringify(event.params)}`,
                  `outTrackId: ${event.outTrackId || "(none)"}`,
                ].join("\n"),
              },
            },
          };
        }
      : createDingTalkGateResumeHandler({
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
            return { ok: true, message: `status=${updated?.status ?? "?"}` };
          },
        });

    const client = await startDingTalkCardStream({
      debug: Boolean(opts.debug),
      onCardCallback,
    });
    console.log(
      opts.probeOnly
        ? "Probe mode: callbacks will not resume tasks. Press Ctrl+C to stop."
        : "Resume mode: awaiting-task gate clicks will call resumeTask. Press Ctrl+C to stop.",
    );
    console.log(
      "Tip: when card template + app credentials are configured (env or settings), `oh web` also starts Stream — do not run both.",
    );
    const stop = () => {
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    await new Promise(() => {});
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

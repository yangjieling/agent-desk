import path from "node:path";
import {
  clipPrompt,
  clipTitle,
  newWorkItemId,
  type Autopilot,
  type AutopilotRun,
  type AutopilotRunSource,
  type WorkItem,
} from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { createTask, enqueueStartTask, type RunnerOptions } from "@agent-desk/runner";
import { getWorkflow, startRun } from "@agent-desk/workflow";
import { nextCronOccurrence } from "./cron-next.js";

function fmtStamp(ts = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function renderAutopilotTitle(ap: Autopilot, when = Date.now()): string {
  const tpl = String(ap.titleTemplate || "").trim();
  const stamp = fmtStamp(when);
  if (tpl) {
    return clipTitle(
      tpl.replace(/\{\{\s*name\s*\}\}/gi, ap.name).replace(/\{\{\s*time\s*\}\}/gi, stamp),
      ap.name,
      200,
    );
  }
  return clipTitle(`${ap.name} · ${stamp}`, ap.name, 200);
}

export function advanceAutopilotSchedule(db: AgentDeskDb, ap: Autopilot, fromMs = Date.now()): Autopilot {
  let next = 0;
  try {
    next = nextCronOccurrence(ap.cronExpression, fromMs);
  } catch {
    next = 0;
  }
  const updated: Autopilot = {
    ...ap,
    nextRunAt: ap.status === "active" ? next : 0,
    updatedAt: Date.now(),
  };
  db.upsertAutopilot(updated);
  return updated;
}

export async function dispatchAutopilot(
  db: AgentDeskDb,
  runnerOpts: RunnerOptions,
  dataDir: string,
  ap: Autopilot,
  opts: { source: AutopilotRunSource; plannedAt?: number; promptExtra?: string },
): Promise<{ run: AutopilotRun; autopilot: Autopilot }> {
  const plannedAt = Number(opts.plannedAt || 0);
  const stub = db.createAutopilotRunStub({
    autopilotId: ap.id,
    source: opts.source,
    plannedAt,
  });
  if (!stub) {
    const existing = plannedAt ? db.findAutopilotRunByPlan(ap.id, plannedAt) : null;
    throw Object.assign(new Error("duplicate_or_busy"), {
      code: "duplicate_run",
      existing,
    });
  }

  let run = stub;
  const mark = (patch: Partial<AutopilotRun>) => {
    run = { ...run, ...patch };
    db.upsertAutopilotRun(run);
  };

  if (ap.concurrencyPolicy === "skip" && db.hasActiveAutopilotRun(ap.id)) {
    // Exclude the stub we just created: count > 1 means another active run.
    const activeOthers = db
      .listAutopilotRuns(ap.id, 20)
      .filter((r) => r.id !== run.id && (r.status === "pending" || r.status === "running"));
    if (activeOthers.length) {
      mark({
        status: "skipped",
        completedAt: Date.now(),
        failureReason: "previous_run_active",
      });
      const advanced = advanceAutopilotSchedule(db, { ...ap, lastRunAt: Date.now() }, Date.now());
      return { run, autopilot: advanced };
    }
  }

  mark({ status: "running" });

  try {
    const title = renderAutopilotTitle(ap);
    const basePrompt = String(ap.runbook || "").trim() || title;
    const extra = String(opts.promptExtra || "").trim();
    const prompt = clipPrompt(extra ? `${basePrompt}\n\n---\n\n${extra}` : basePrompt);
    const projectDir = path.resolve(ap.projectDir || process.cwd());
    const settings = db.getSettings();
    let workItemId = "";

    if (ap.action === "skill_task" && ap.executionMode === "create_work_item") {
      const now = Date.now();
      const item: WorkItem = {
        id: newWorkItemId(),
        title,
        description: prompt,
        status: "open",
        projectDir,
        issueProvider: "",
        issueCode: "",
        agentProfileId: ap.agentProfileId || "",
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      };
      db.upsertWorkItem(item);
      workItemId = item.id;
    }

    if (ap.action === "workflow_run") {
      const wfId = String(ap.workflowId || "").trim();
      if (!wfId) throw new Error("workflow_id_required");
      if (!getWorkflow(dataDir, wfId)) throw new Error(`workflow_not_found:${wfId}`);
      const wr = startRun(dataDir, runnerOpts, {
        workflowId: wfId,
        title,
        inputPrompt: prompt,
        projectDir,
        agentProfileId: ap.agentProfileId || undefined,
      });
      mark({
        status: "completed",
        completedAt: Date.now(),
        taskId: wr.parentTaskId || "",
        workflowRunId: wr.id,
        workItemId,
      });
    } else {
      const skill = String(ap.skill || "").trim() || "default";
      const agent = ap.agentProfileId ? db.getAgent(ap.agentProfileId) : null;
      const resolvedSkill =
        skill !== "default" ? skill : agent?.defaultSkill || skill;
      const task = createTask(
        {
          title,
          prompt,
          projectDir,
          skill: resolvedSkill,
          workItemId: workItemId || undefined,
          agentProfileId: ap.agentProfileId || undefined,
          model: ap.model || undefined,
        },
        settings,
        runnerOpts,
      );
      db.upsertTask(task);
      enqueueStartTask(runnerOpts, task.id);
      mark({
        status: "completed",
        completedAt: Date.now(),
        taskId: task.id,
        workItemId: task.workItemId || workItemId,
      });
    }

    const advanced = advanceAutopilotSchedule(
      db,
      { ...ap, lastRunAt: Date.now() },
      Math.max(Date.now(), plannedAt || 0),
    );
    return { run, autopilot: advanced };
  } catch (e) {
    mark({
      status: "failed",
      completedAt: Date.now(),
      failureReason: e instanceof Error ? e.message : String(e),
    });
    const advanced = advanceAutopilotSchedule(
      db,
      { ...ap, lastRunAt: Date.now() },
      Math.max(Date.now(), plannedAt || 0),
    );
    return { run, autopilot: advanced };
  }
}

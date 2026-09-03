import {
  clipPrompt,
  clipTitle,
  type AgentProfile,
  type Task,
  type WorkItem,
} from "@agent-desk/core";
import type { AgentDeskDb } from "@agent-desk/db";
import { createTask, enqueueStartTask, type RunnerOptions } from "@agent-desk/runner";

const ACTIVE = new Set(["created", "queued", "dispatched", "running", "awaiting"]);

export type WorkItemTriggerKind = "assignment" | "mention";

export interface ParsedAgentMention {
  agentProfileId: string;
  label: string;
  /** Raw token matched in text (e.g. `@Claude` or mention:// link). */
  raw: string;
}

/** Match Multica-style links and plain `@Name` / `@a_…` tokens. */
export function parseAgentMentions(text: string, agents: AgentProfile[]): ParsedAgentMention[] {
  const body = String(text || "");
  if (!body.trim() || !agents.length) return [];

  const byId = new Map(agents.map((a) => [a.id, a]));
  const found = new Map<string, ParsedAgentMention>();

  const linkRe = /\[([^\]]+)\]\(mention:\/\/agent\/([a-zA-Z0-9_-]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(body)) !== null) {
    const id = m[2];
    const agent = byId.get(id);
    if (!agent || found.has(id)) continue;
    found.set(id, { agentProfileId: id, label: agent.name, raw: m[0] });
  }

  const sortedNames = [...agents]
    .filter((a) => String(a.name || "").trim())
    .sort((a, b) => {
      const dl = b.name.trim().length - a.name.trim().length;
      if (dl) return dl;
      return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
    });

  const claimedNames = new Set<string>();
  for (const agent of sortedNames) {
    if (found.has(agent.id)) continue;
    const name = agent.name.trim();
    const nameKey = name.toLowerCase();
    if (claimedNames.has(nameKey)) continue;
    const nameEsc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRe = new RegExp(`(?:^|[^\\w@])@(${nameEsc})(?=$|[^\\w-])`, "iu");
    const hit = nameRe.exec(body);
    if (!hit) continue;
    claimedNames.add(nameKey);
    found.set(agent.id, {
      agentProfileId: agent.id,
      label: agent.name,
      raw: `@${hit[1]}`,
    });
  }

  const idRe = /(?:^|[^\w@])@(a_[a-zA-Z0-9]+)\b/g;
  while ((m = idRe.exec(body)) !== null) {
    const id = m[1];
    if (found.has(id)) continue;
    const agent = byId.get(id);
    if (!agent) continue;
    found.set(id, { agentProfileId: id, label: agent.name, raw: `@${id}` });
  }

  return [...found.values()];
}

function recentNotesBlock(db: AgentDeskDb, workItemId: string, limit = 5): string {
  const notes = db
    .listWorkItemEvents(workItemId, 50)
    .filter((e) => e.kind === "note" || e.kind === "gate_reply")
    .slice(-limit);
  if (!notes.length) return "";
  const lines = notes.map((e) => {
    const who = e.author || "user";
    return `- (${who}) ${e.body}`;
  });
  return `## Recent discussion\n${lines.join("\n")}`;
}

export function buildWorkItemRunPrompt(
  db: AgentDeskDb,
  item: WorkItem,
  opts: { trigger: WorkItemTriggerKind; note?: string; mentionLabel?: string },
): string {
  const parts: string[] = [];
  parts.push(`# Work item: ${item.title || item.id}`);
  if (item.issueCode) parts.push(`Issue: ${item.issueCode}`);
  const desc = String(item.description || "").trim();
  if (desc) parts.push(desc);

  const note = String(opts.note || "").trim();
  if (opts.trigger === "assignment") {
    parts.push("## Trigger\nAssigned to you. Please pick up this work item.");
    if (note) parts.push(`## Handoff note\n${note}`);
  } else {
    const who = opts.mentionLabel ? `@${opts.mentionLabel}` : "You";
    parts.push(`## Trigger\n${who} was mentioned in a work-item note. Please respond.`);
    if (note) parts.push(`## Mention note\n${note}`);
  }

  const recent = recentNotesBlock(db, item.id);
  if (recent) parts.push(recent);

  return clipPrompt(parts.join("\n\n"));
}

export function findActiveTaskForAgent(
  db: AgentDeskDb,
  workItemId: string,
  agentProfileId: string,
): Task | null {
  const id = String(agentProfileId || "").trim();
  if (!id) return null;
  return (
    db.listTasksForWorkItem(workItemId, 200).find(
      (t) => ACTIVE.has(t.status) && String(t.agentProfileId || "").trim() === id,
    ) || null
  );
}

export function dispatchWorkItemRun(
  db: AgentDeskDb,
  runnerOpts: RunnerOptions,
  input: {
    workItem: WorkItem;
    agentProfileId: string;
    trigger: WorkItemTriggerKind;
    note?: string;
    mentionLabel?: string;
    titleSuffix?: string;
  },
): { task: Task; coalesced: false } | { task: Task; coalesced: true } {
  const agentProfileId = String(input.agentProfileId || "").trim();
  if (!agentProfileId) throw new Error("agent_required");
  const agent = db.getAgent(agentProfileId);
  if (!agent) throw new Error("agent_not_found");

  const existing = findActiveTaskForAgent(db, input.workItem.id, agentProfileId);
  if (existing) {
    return { task: existing, coalesced: true };
  }

  const settings = db.getSettings();
  const suffix = String(input.titleSuffix || "").trim();
  const title = clipTitle(
    suffix ? `${input.workItem.title || "Work item"} · ${suffix}` : input.workItem.title || "Work item",
    "Work item",
    200,
  );
  const prompt = buildWorkItemRunPrompt(db, input.workItem, {
    trigger: input.trigger,
    note: input.note,
    mentionLabel: input.mentionLabel || agent.name,
  });

  const task = createTask(
    {
      title,
      prompt,
      projectDir: input.workItem.projectDir || process.cwd(),
      workItemId: input.workItem.id,
      issueCode: input.workItem.issueCode || undefined,
      skill: agent.defaultSkill || "default",
      agentProfileId,
    },
    settings,
    runnerOpts,
  );
  db.upsertTask(task);
  enqueueStartTask(runnerOpts, task.id);
  return { task, coalesced: false };
}

export function assignWorkItem(
  db: AgentDeskDb,
  runnerOpts: RunnerOptions,
  workItemId: string,
  opts: { agentProfileId?: string; start?: boolean; note?: string },
): {
  workItem: WorkItem;
  started: boolean;
  coalesced: boolean;
  task: Task | null;
  skippedReason: string;
} {
  const current = db.getWorkItem(workItemId);
  if (!current) throw Object.assign(new Error("not_found"), { code: "not_found" });

  const nextId = String(opts.agentProfileId ?? "").trim();
  if (nextId && !db.getAgent(nextId)) {
    throw Object.assign(new Error("agent_not_found"), { code: "agent_not_found" });
  }

  const prevId = String(current.agentProfileId || "").trim();
  const changed = prevId !== nextId;
  const now = Date.now();
  const next: WorkItem = {
    ...current,
    agentProfileId: nextId,
    updatedAt: now,
    lastActivityAt: now,
  };
  db.upsertWorkItem(next);

  const note = String(opts.note || "").trim().slice(0, 2000);
  if (changed) {
    if (nextId) {
      const agent = db.getAgent(nextId);
      const label = agent?.name || nextId;
      db.addWorkItemEvent({
        workItemId: next.id,
        kind: "system",
        author: "user",
        body: note ? `分配给 ${label}：${note}` : `分配给 ${label}`,
      });
    } else {
      db.addWorkItemEvent({
        workItemId: next.id,
        kind: "system",
        author: "user",
        body: "已取消分配",
      });
    }
  }

  const wantStart = opts.start !== false;
  if (!nextId) {
    return {
      workItem: db.getWorkItem(next.id) ?? next,
      started: false,
      coalesced: false,
      task: null,
      skippedReason: "unassigned",
    };
  }
  if (!wantStart) {
    return {
      workItem: db.getWorkItem(next.id) ?? next,
      started: false,
      coalesced: false,
      task: null,
      skippedReason: "start_suppressed",
    };
  }
  if (next.status === "cancelled") {
    return {
      workItem: db.getWorkItem(next.id) ?? next,
      started: false,
      coalesced: false,
      task: null,
      skippedReason: "cancelled",
    };
  }
  if (!changed && opts.start !== true) {
    // Re-selecting the same assignee does not wake unless start is forced true.
    return {
      workItem: db.getWorkItem(next.id) ?? next,
      started: false,
      coalesced: false,
      task: null,
      skippedReason: "unchanged",
    };
  }

  const result = dispatchWorkItemRun(db, runnerOpts, {
    workItem: db.getWorkItem(next.id) ?? next,
    agentProfileId: nextId,
    trigger: "assignment",
    note,
    titleSuffix: "assigned",
  });

  return {
    workItem: db.getWorkItem(next.id) ?? next,
    started: !result.coalesced,
    coalesced: result.coalesced,
    task: result.task,
    skippedReason: result.coalesced ? "already_active" : "",
  };
}

export function triggerMentionRuns(
  db: AgentDeskDb,
  runnerOpts: RunnerOptions,
  workItem: WorkItem,
  noteBody: string,
  opts?: { wake?: boolean },
): {
  mentions: ParsedAgentMention[];
  started: Task[];
  coalesced: Task[];
} {
  if (opts?.wake === false) {
    return { mentions: [], started: [], coalesced: [] };
  }
  const mentions = parseAgentMentions(noteBody, db.listAgents());
  const started: Task[] = [];
  const coalesced: Task[] = [];
  for (const mention of mentions) {
    try {
      const result = dispatchWorkItemRun(db, runnerOpts, {
        workItem,
        agentProfileId: mention.agentProfileId,
        trigger: "mention",
        note: noteBody,
        mentionLabel: mention.label,
        titleSuffix: `@${mention.label}`,
      });
      if (result.coalesced) coalesced.push(result.task);
      else started.push(result.task);
    } catch {
      // Skip unknown / failed agents; note already saved.
    }
  }
  return { mentions, started, coalesced };
}

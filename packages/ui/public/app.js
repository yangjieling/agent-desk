/* agent-desk Web UI */
const TITLE_MAX = 80;
const PROMPT_MAX = 8000;
const TASK_PAGE_SIZE = 15;
const BOARD_PHASES = ["created", "preparing", "running", "awaiting"];
const URL_PARAMS = new URLSearchParams(location.search);
let DEEP_LINK_REPLY = (URL_PARAMS.get("reply") || "").trim();
let DEEP_LINK_REPLY_SENT = false;

let TASKS = [];
let TASK_FILTER = "all";
let AWAITING_COUNT = 0;
let TASK_PAGE = 1;
let TASK_POLL_TIMER = null;
let TASK_POLL_SIG = "";
const EXPANDED_TASK_GROUPS = new Set();
/** collapsed workspace keys (projectDir); absent = expanded */
const COLLAPSED_WORKSPACES = new Set();

let WORKFLOW_LIST = [];
let WF_FILTER = "all";
let WF_RUNS = [];
let WF_EDIT = null; // { id, name, description, mode, nodes, isNew }
let WF_SKILL_OPTS = [];

let SKILL_LIST = [];
let SK_FILTER = "all";
let CURRENT_VIEW = "dashboard";
let DASH_POLL_TIMER = null;
let INBOX_POLL_TIMER = null;

let BUGS = [];
let BUG_PAGE = 1;
const BUG_PAGE_SIZE = 15;
let BUG_FILTER_KW = "";
/** @type {Map<string, object>} */
const ISSUE_CACHE = new Map();

let LOG_ID = null;
let LOG_REPLY_MODEL_KEY = "";
let LOG_TITLE = "";
let LOG_SSE = null;
let LOG_SSE_TASK = "";
let LOG_SSE_OPEN = false;
/** Timestamp when current SSE connect attempt started (0 = idle). */
let LOG_SSE_CONNECT_AT = 0;
/** Timestamp when SSE last became open. */
let LOG_SSE_OPEN_AT = 0;
/** Timestamp when SSE last closed/errored while task still live. */
let LOG_SSE_CLOSED_AT = 0;
let LOG_SSE_RETRY_TIMER = 0;
let LOG_STREAM_RENDER_RAF = 0;
let LOG_STREAM_PENDING = null;
let LOG_STREAM_PATCH_LEN = 0;
let LOG_RESULT = "";
let LOG_RESULT_LEN = 0;
/** @type {ReturnType<typeof createIncrementalLogParser> | null} */
let LOG_TIMELINE_PARSER = null;
let LOG_RUN_STARTED_AT = 0;
let LOG_LAST_STREAM_AT = 0;
let LOG_ACTIVITY_TICKER = 0;
let LOG_STREAM_EPOCH = 0;
/** When true, raw log drawer sticks to bottom on new output. */
let LOG_RAW_PIN_BOTTOM = true;
let LOG_CHOICES_KEY = "";
let LOG_VIEW_MODE = "timeline"; // timeline | raw
let LOG_RENDER_SIG = "";
let LOG_PENDING_USER = "";
/** True while a reply is in-flight (before status becomes running). */
let LOG_REPLY_SENDING = false;
/** In-flight lock for header/list start & continue actions (issue #1). */
let LOG_TASK_ACTION_BUSY = false;
let LOG_SCROLL_TO_BOTTOM = false;
let LOG_TASK_STATUS = "";
/** @type {null | { type: string, workflowId: string, title?: string, prompt?: string, issueCode?: string }} */
let WS_PICK_PURPOSE = null;
let LOG_WF_RUN_ID = "";
let LOG_WF_CACHE = null;

const STATUS_LABEL = {
  created: "待执行",
  queued: "排队中",
  running: "运行中",
  awaiting: "待确认",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

const WORK_ITEM_STATUS_LABEL = {
  open: "进行中",
  in_progress: "执行中",
  in_review: "待验收",
  done: "已完成",
  cancelled: "已取消",
};

const WORK_ITEM_EVENT_KIND_LABEL = {
  note: "备注",
  gate_reply: "闸门",
  run_linked: "执行",
  system: "系统",
};

let WORK_ITEM_MODAL_ID = "";
let WORK_ITEM_NOTE_SENDING = false;

const FAILURE_CODE_LABEL = {
  workspace_busy: "工作区占用",
  spawn_error: "启动失败",
  exit_nonzero: "异常退出",
  backend_unavailable: "CLI 不可用",
  start_error: "启动错误",
};

const ICON_PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#3b82f6"];

const VIEW_TITLES = {
  dashboard: ["总览看板", "基于本地任务与缺陷源的实时概览"],
  inbox: ["待办", "闸门确认与工作项验收"],
  bugs: ["缺陷列表", "从 Issue Provider 拉取；支持 AI 修复并查看关联任务"],
  workflows: ["流程编排", "模板与运行记录；最近运行可跳转至任务"],
  skills: ["技能", "内置随 CLI 同步更新；用户自建可卸载"],
  agents: ["智能体", "可命名的 Agent 配置：提供方、模型、技能与系统指令"],
  autopilots: ["自动化", "按计划定时创建任务或启动流程（需 oh web 保持运行）"],
  "tasks-new": ["新建任务", "创建技能任务或启动流程"],
  "tasks-list": ["任务管理", "执行日志、闸门确认与工作区"],
  settings: ["集成与偏好", "通知、缺陷来源与任务默认行为"],
};

const SKILL_SOURCE_LABEL = {
  bundled: "内置",
  user: "用户自建",
  "project-agent-desk": "项目",
  "project-agents": "项目 (.agents)",
  custom: "自定义",
};

const RECENT_DIR_KEY = "ad_recent_project_dirs";
const RECENT_DIR_MAX = 5;
let FS_BROWSER_PATH = "";
let FS_BROWSER_PARENT = "";
let FS_ENTRIES = [];
let WS_TAB = "browse";
let creating = false;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

function iconColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return ICON_PALETTE[h % ICON_PALETTE.length];
}

function fmtTime(ts) {
  if (!ts) return "-";
  const d = new Date(typeof ts === "number" && ts < 1e12 ? ts * 1000 : ts);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shortPath(p) {
  const s = String(p || "");
  if (!s) return "-";
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

function tField(t, camel, snake) {
  if (!t) return "";
  if (t[camel] !== undefined && t[camel] !== null && t[camel] !== "") return t[camel];
  return t[snake] ?? "";
}

function isChildTask(t) {
  return !!String(tField(t, "parentTaskId", "parent_task_id")).trim();
}

function getParentTask(t) {
  const pid = String(tField(t, "parentTaskId", "parent_task_id")).trim();
  if (!pid) return null;
  return TASKS.find((x) => x.id === pid) || null;
}

function isSharedWorkflow(t) {
  return tField(t, "taskType", "task_type") === "workflow" && tField(t, "workflowMode", "workflow_mode") !== "independent";
}

function isIndependentWorkflow(t) {
  return tField(t, "taskType", "task_type") === "workflow" && tField(t, "workflowMode", "workflow_mode") === "independent";
}

function uiRootTasks() {
  return TASKS.filter((t) => !isChildTask(t));
}

function taskPhase(t) {
  return t.status || "created";
}

function taskPhaseLabel(t) {
  if (t.status === "queued") {
    const retry = Number(t.retryCount || t.retry_count || 0);
    if (retry > 0) return `排队重试 (${retry})`;
    return STATUS_LABEL.queued;
  }
  return STATUS_LABEL[t.status] || t.status || "-";
}

function taskRetryHint(t) {
  const code = String(t.failureCode || t.failure_code || "").trim();
  const msg = String(t.failureMessage || t.failure_message || "").trim();
  const nextAt = Number(t.nextRetryAt || t.next_retry_at || 0);
  const parts = [];
  if (code) parts.push(FAILURE_CODE_LABEL[code] || code);
  if (t.status === "queued" && nextAt > Date.now()) {
    parts.push(`${Math.max(1, Math.ceil((nextAt - Date.now()) / 1000))}s 后重试`);
  } else if (msg) parts.push(msg);
  return parts.join(" · ");
}

function taskListSignature(tasks) {
  return (tasks || [])
    .map((t) =>
      [
        t.id,
        t.status || "",
        tField(t, "workflowStep", "workflow_step"),
        tField(t, "workflowStepTotal", "workflow_step_total"),
        t.updatedAt || t.updated_at || "",
        t.lastActivityAt || t.last_activity_at || "",
        t.retryCount || t.retry_count || 0,
        t.failureCode || t.failure_code || "",
        t.nextRetryAt || t.next_retry_at || 0,
      ].join(":"),
    )
    .sort()
    .join("|");
}

function hasActiveTasks(tasks) {
  return (tasks || []).some((t) => ["running", "awaiting", "created", "queued"].includes(t.status || ""));
}

function buildTaskGroups(tasks) {
  const byParent = new Map();
  (tasks || []).forEach((t) => {
    const pid = String(tField(t, "parentTaskId", "parent_task_id")).trim();
    if (!pid) return;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(t);
  });
  byParent.forEach((list) =>
    list.sort((a, b) => {
      const ai = tField(a, "workflowNodeIndex", "workflow_node_index");
      const bi = tField(b, "workflowNodeIndex", "workflow_node_index");
      if (ai == null && bi == null) return 0;
      if (ai == null) return 1;
      if (bi == null) return -1;
      return Number(ai) - Number(bi);
    }),
  );
  return (tasks || [])
    .filter((t) => !isChildTask(t))
    .map((parent) => {
      let children = byParent.get(parent.id) || [];
      if (isSharedWorkflow(parent)) children = [];
      return { parent, children };
    });
}

function isGroupExpanded(parentId, children) {
  return children.length > 0 && EXPANDED_TASK_GROUPS.has(parentId);
}

function taskMatchesFilter(t) {
  if (TASK_FILTER === "all") return true;
  if (TASK_FILTER === "preparing") return false;
  return (t.status || "") === TASK_FILTER;
}

function groupMatchesFilter(group) {
  if (taskMatchesFilter(group.parent)) return true;
  if (isSharedWorkflow(group.parent)) return false;
  return group.children.some(taskMatchesFilter);
}


function workspaceKeyOf(t) {
  return String(tField(t, "projectDir", "project_dir") || "").trim();
}

function isWorkspaceExpanded(key) {
  return !COLLAPSED_WORKSPACES.has(key || "");
}

function buildWorkspaceSections(taskGroups) {
  const map = new Map();
  for (const g of taskGroups || []) {
    const key = workspaceKeyOf(g.parent);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(g);
  }
  const keys = [...map.keys()].sort((a, b) => {
    if (!a && b) return 1;
    if (a && !b) return -1;
    return a.localeCompare(b);
  });
  return keys.map((key) => ({
    key,
    label: key ? shortPath(key) : "未指定工作区",
    full: key || "",
    groups: map.get(key),
  }));
}

function renderWorkspaceSection(section) {
  const key = section.key || "";
  const open = isWorkspaceExpanded(key);
  const count = (section.groups || []).length;
  const title = esc(section.full || section.label);
  const label = esc(section.label);
  let html =
    `<div class="ws-section${open ? " open" : ""}" data-ws-key="${esc(key)}">` +
    `<button type="button" class="ws-section-head" data-act="toggle-ws" data-ws="${esc(key)}" title="${title}">` +
    `<span class="ws-chev" aria-hidden="true">▸</span>` +
    `<span class="ws-name">${label}</span>` +
    `<span class="ws-count">${count}</span>` +
    `</button>`;
  if (open) {
    html += `<div class="ws-section-body">${(section.groups || []).map(renderTaskGroup).join("")}</div>`;
  }
  html += "</div>";
  return html;
}

function childStepLabel(child, idx, total) {
  const title = String(tField(child, "title", "title") || "").trim();
  const sep = title.indexOf(" · ");
  if (sep >= 0) return title.slice(sep + 3);
  const n =
    tField(child, "workflowNodeIndex", "workflow_node_index") != null
      ? Number(tField(child, "workflowNodeIndex", "workflow_node_index")) + 1
      : idx + 1;
  return total > 0 ? `步骤 ${n}/${total}` : `步骤 ${n}`;
}

function parseGate(text) {
  if (!text) return null;
  const hasChoices = text.includes("oh-choices") || text.includes("hb-choices");
  if (!hasChoices && !text.includes("闸门")) return null;
  const idxOh = text.indexOf("## oh-choices");
  const idxHb = text.indexOf("## hb-choices");
  const idx =
    idxOh >= 0 && idxHb >= 0 ? Math.min(idxOh, idxHb) : Math.max(idxOh, idxHb);
  if (idx < 0 && !text.includes("闸门")) return null;
  const section = idx >= 0 ? text.slice(idx) : text;
  const headingMatch = text.match(/##\s*闸门[「"']([^」"']+)[」"']/);
  const choices = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const raw = trimmed.slice(1).trim();
    const sep = raw.includes("|") ? "|" : raw.includes("｜") ? "｜" : null;
    if (sep) {
      const [label, value] = raw.split(sep).map((s) => s.trim());
      if (label && value) choices.push({ label, value });
    } else if (raw) choices.push({ label: raw, value: raw });
  }
  return {
    heading: headingMatch ? `闸门「${headingMatch[1]}」` : "闸门",
    choices,
  };
}

function isAbortChoice(label, value) {
  const s = `${label || ""} ${value || ""}`;
  return /先不修|暂不修|skip|cancel|不处理|不修了/i.test(s);
}

function prettyJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj ?? "");
  }
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((c) => {
      if (!c || typeof c !== "object") return "";
      if (c.type === "text") return String(c.text || "");
      if (typeof c.text === "string") return c.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractToolsFromContent(content) {
  if (!Array.isArray(content)) return [];
  const tools = [];
  for (const c of content) {
    if (!c || typeof c !== "object") continue;
    if (c.type === "tool_use" || c.name) {
      tools.push({
        name: String(c.name || c.tool || "tool"),
        input: c.input ?? c.arguments ?? c,
        id: c.id || "",
      });
    }
  }
  return tools;
}

function logTimelineHelpers() {
  return { extractTextFromContent, extractToolsFromContent, prettyJson };
}

function resetLogBuffer(raw) {
  LOG_RESULT = raw || "";
  LOG_RESULT_LEN = LOG_RESULT.length;
  LOG_TIMELINE_PARSER = createIncrementalLogParser(logTimelineHelpers());
  LOG_TIMELINE_PARSER.reset(LOG_RESULT);
}

function appendLogBuffer(chunk) {
  if (!chunk) return;
  LOG_RESULT += chunk;
  LOG_RESULT_LEN = LOG_RESULT.length;
  if (!LOG_TIMELINE_PARSER) {
    resetLogBuffer(LOG_RESULT);
    return;
  }
  LOG_TIMELINE_PARSER.append(chunk);
}

function appendRawLogDelta(chunk) {
  const body = document.getElementById("logBody");
  if (!body || !chunk) return;
  if (body.textContent === "(暂无输出)") body.textContent = "";
  body.textContent += chunk;
  if (LOG_RAW_PIN_BOTTOM) body.scrollTop = body.scrollHeight;
}

function mergeStreamTask(task, resultAppend) {
  if (resultAppend) {
    appendLogBuffer(resultAppend);
    appendRawLogDelta(resultAppend);
  } else if (task?.result != null) {
    const next = String(task.result);
    if (!next && LOG_RESULT_LEN > 0) {
      // SSE payload omitted result; keep the buffered log.
    } else if (next.length < LOG_RESULT_LEN) {
      resetLogBuffer(next);
      updateRawLogBody(next);
    } else if (next.length > LOG_RESULT_LEN) {
      const delta = next.slice(LOG_RESULT_LEN);
      appendLogBuffer(delta);
      appendRawLogDelta(delta);
    } else {
      LOG_RESULT = next;
    }
  }
  return { ...task, result: LOG_RESULT || task?.result || "" };
}

function parseLogTimelineLocal(raw) {
  return parseLogTimeline(raw, logTimelineHelpers());
}

function renderLogMeta(task) {
  const el = document.getElementById("logMeta");
  if (!el || !task) return;
  const primary = [];
  const more = [];
  const st = task.status || "";
  primary.push(`<span class="log-meta-chip status-${esc(st)}">${esc(STATUS_LABEL[st] || st || "-")}</span>`);
  const agentChip = agentChipLabelForTask(task);
  if (agentChip) {
    primary.push(`<span class="log-meta-chip" title="任务 Agent">${esc(agentChip)}</span>`);
  }
  const projFull = tField(task, "projectDir", "project_dir");
  const proj = shortPath(projFull);
  if (proj && proj !== "-") {
    primary.push(`<span class="log-meta-chip" title="${esc(projFull)}">${esc(proj)}</span>`);
  }

  const skill = tField(task, "skill", "skill");
  if (skill) more.push(`<span class="log-meta-chip">技能 ${esc(skill)}</span>`);
  const wf = tField(task, "workflowName", "workflow_name");
  const step = Number(tField(task, "workflowStep", "workflow_step") || 0);
  const total = Number(tField(task, "workflowStepTotal", "workflow_step_total") || 0);
  if (wf) {
    more.push(
      `<span class="log-meta-chip">${esc(wf)}${total > 0 ? ` · ${step}/${total}` : ""}</span>`,
    );
  }
  const issue = tField(task, "issueCode", "issue_code");
  if (issue) more.push(`<span class="log-meta-chip bug-code">${esc(issue)}</span>`);
  const model = (tField(task, "model", "model") || "").trim();
  if (model) {
    more.push(`<span class="log-meta-chip" title="任务模型">${esc(model)}</span>`);
  } else if (agentChip) {
    more.push(`<span class="log-meta-chip" title="任务模型">默认模型</span>`);
  }
  const retryCount = Number(tField(task, "retryCount", "retry_count") || 0);
  if (retryCount > 0) more.push(`<span class="log-meta-chip">重试 ${retryCount}</span>`);
  const failureCode = String(tField(task, "failureCode", "failure_code") || "").trim();
  if (failureCode) {
    more.push(
      `<span class="log-meta-chip log-meta-fail" title="${esc(tField(task, "failureMessage", "failure_message"))}">${esc(FAILURE_CODE_LABEL[failureCode] || failureCode)}</span>`,
    );
  }
  const retryHint = taskRetryHint(task);
  if (retryHint && (st === "queued" || st === "failed")) {
    more.push(`<span class="log-meta-chip">${esc(retryHint)}</span>`);
  }
  const usageChip = formatTaskUsageChip(task.usage || extractUsageFromTaskResult(task));
  if (usageChip) {
    more.push(
      `<span class="log-meta-chip" title="${esc(usageChip.title)}">${esc(usageChip.label)}</span>`,
    );
  }

  let html = `<div class="log-meta-primary">${primary.join("")}</div>`;
  if (more.length) {
    html += `<details class="log-meta-more"><summary>详情</summary><div class="log-meta-more-chips">${more.join("")}</div></details>`;
  }
  el.innerHTML = html;
}

function formatTaskUsageChip(u) {
  if (!u) return null;
  const input = Number(u.inputTokens || 0);
  const output = Number(u.outputTokens || 0);
  const cacheRead = Number(u.cacheReadTokens || 0);
  const cacheWrite = Number(u.cacheWriteTokens || 0);
  const cost = u.costUsd == null ? null : Number(u.costUsd);
  if (!(input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0 || (cost != null && cost >= 0))) {
    return null;
  }
  const fmt = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return String(n);
  };
  const parts = [];
  if (input) parts.push(`${fmt(input)} in`);
  if (output) parts.push(`${fmt(output)} out`);
  if (cost != null && cost > 0) {
    parts.push(cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`);
  }
  const titleBits = [
    `input ${input}`,
    `output ${output}`,
    cacheRead ? `cache read ${cacheRead}` : "",
    cacheWrite ? `cache write ${cacheWrite}` : "",
    cost != null ? `cost $${cost}` : "",
  ].filter(Boolean);
  return { label: parts.length ? parts.join(" · ") : "用量", title: titleBits.join(" · ") };
}

/** Client fallback when API has not attached `usage` (e.g. mid-stream SSE). Claude-shaped only. */
function extractUsageFromTaskResult(task) {
  const raw = String((task && task.result) || "");
  if (!raw) return null;
  const lines = raw.split("\n");
  let best = null;
  const pick = (obj, keys) => {
    for (const k of keys) {
      const n = Number(obj && obj[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  for (const line of lines) {
    const bare = line.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?\] /, "").trim();
    if (!bare.startsWith("{") || !bare.endsWith("}")) continue;
    let evt;
    try {
      evt = JSON.parse(bare);
    } catch {
      continue;
    }
    if (evt.type !== "result") continue;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let costUsd = null;
    if (evt.modelUsage && typeof evt.modelUsage === "object") {
      for (const part of Object.values(evt.modelUsage)) {
        if (!part || typeof part !== "object") continue;
        inputTokens += pick(part, ["input_tokens", "inputTokens", "input"]);
        outputTokens += pick(part, ["output_tokens", "outputTokens", "output"]);
        cacheReadTokens += pick(part, [
          "cache_read_input_tokens",
          "cacheReadInputTokens",
          "cacheReadTokens",
        ]);
        cacheWriteTokens += pick(part, [
          "cache_creation_input_tokens",
          "cacheCreationInputTokens",
          "cacheWriteTokens",
        ]);
        const c = Number(part.costUSD);
        if (Number.isFinite(c) && c >= 0) costUsd = (costUsd || 0) + c;
      }
    }
    if (!(inputTokens || outputTokens || cacheReadTokens || cacheWriteTokens) && evt.usage) {
      inputTokens = pick(evt.usage, ["input_tokens", "inputTokens", "input"]);
      outputTokens = pick(evt.usage, ["output_tokens", "outputTokens", "output"]);
      cacheReadTokens = pick(evt.usage, [
        "cache_read_input_tokens",
        "cacheReadInputTokens",
        "cacheReadTokens",
      ]);
      cacheWriteTokens = pick(evt.usage, [
        "cache_creation_input_tokens",
        "cacheCreationInputTokens",
        "cacheWriteTokens",
      ]);
    }
    if (costUsd == null && evt.total_cost_usd != null) {
      const c = Number(evt.total_cost_usd);
      if (Number.isFinite(c) && c >= 0) costUsd = c;
    }
    if (inputTokens || outputTokens || cacheReadTokens || cacheWriteTokens || costUsd != null) {
      best = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd };
    }
  }
  return best;
}

/** Creation-time task description (prompt), without later User reply appendices. */
function taskDescriptionFromPrompt(prompt) {
  const raw = String(prompt || "");
  const cut = raw.split(/\n---\nUser reply:\n/)[0] || "";
  return cut.trim();
}

function renderLogTaskDetail(task) {
  const box = document.getElementById("logTaskDetail");
  const peekEl = document.getElementById("logTaskDetailPeek");
  const bodyEl = document.getElementById("logTaskDetailBody");
  if (!box || !bodyEl) return;
  const desc = taskDescriptionFromPrompt(task && task.prompt);
  if (!desc) {
    box.hidden = true;
    bodyEl.textContent = "";
    bodyEl.classList.add("is-empty");
    if (peekEl) peekEl.textContent = "";
    return;
  }
  const peek = desc.replace(/\s+/g, " ");
  if (peekEl) peekEl.textContent = peek.length > 96 ? `${peek.slice(0, 96)}…` : peek;
  bodyEl.textContent = desc;
  bodyEl.classList.remove("is-empty");
  box.hidden = false;
}

function renderLogBodyHtml(type, bodyText) {
  const text = String(bodyText || "");
  if ((type === "assistant" || type === "user") && typeof renderLogMarkdown === "function") {
    return renderLogMarkdown(text);
  }
  return esc(text);
}

function renderLogTimeline(items) {
  const box = document.getElementById("logTimeline");
  if (!box) return;
  const list = items.slice();
  if (LOG_PENDING_USER) {
    const already = list.some(
      (it) => it.type === "user" && String(it.text || "").includes(LOG_PENDING_USER),
    );
    if (!already) list.push({ type: "user", text: LOG_PENDING_USER });
  }
  if (!list.length) {
    // P0-1: running wait state lives in the sticky footer — avoid dual empty + thinking UI.
    if (LOG_TASK_STATUS === "running" || LOG_REPLY_SENDING) {
      box.innerHTML = "";
      return;
    }
    if (LOG_TASK_STATUS === "queued" || LOG_TASK_STATUS === "created") {
      box.innerHTML = '<div class="log-empty">任务已创建，等待开始执行…</div>';
      return;
    }
    box.innerHTML = '<div class="log-empty">暂无输出</div>';
    return;
  }
  const hasAssistant = list.some((it) => it.type === "assistant" && String(it.text || "").trim());
  const showPulse =
    LOG_TASK_STATUS === "running" &&
    !hasAssistant &&
    list.every((it) => it.type === "activity" || it.type === "user");
  box.innerHTML =
    list
      .map((it, i) => {
      const type = it.type || "assistant";
      const streaming =
        LOG_TASK_STATUS === "running" && i === list.length - 1 && type === "assistant";
      if (type === "activity") {
        const running = it.status === "running";
        return `<div class="log-activity${running ? " is-running" : ""}">
          <span class="log-activity-icon" aria-hidden="true">${running ? '<span class="log-activity-spin"></span>' : "✓"}</span>
          <span class="log-activity-text">${esc(it.text || "")}</span>
        </div>`;
      }
      if (type === "tool") {
        const name = esc(it.toolName || it.text || "tool");
        const detail = esc(it.detail || "");
        return `<div class="log-item tool">
          <div class="li-head"><span class="li-role">工具</span></div>
          <details>
            <summary>${name}</summary>
            <pre>${detail || "(无参数)"}</pre>
          </details>
        </div>`;
      }
      const role =
        type === "user" ? "你" : type === "gate" ? "闸门" : type === "system" ? "系统" : "助手";
      const bodyText =
        type === "gate"
          ? String(it.text || "")
              .replace(/##\s*oh-choices[\s\S]*$/i, "")
              .replace(/##\s*hb-choices[\s\S]*$/i, "")
              .replace(/##\s*dangerous-cmd-pending[\s\S]*?(?=##|$)/i, "")
              .trim() || it.text
          : it.text;
      return `<div class="log-item ${esc(type)}${streaming ? " is-streaming" : ""}">
        <div class="li-head"><span class="li-role">${role}</span></div>
        <div class="li-body${type === "assistant" || type === "user" ? " log-md-body" : ""}">${renderLogBodyHtml(type, bodyText)}</div>
      </div>`;
    })
    .join("") +
    (showPulse
      ? `<div class="log-stream-pulse" aria-live="polite">
          <span>等待首条回复…</span>
          <div class="log-stream-pulse-bar" aria-hidden="true"><span></span></div>
        </div>`
      : "");
}

function extractUserRepliesFromPrompt(prompt) {
  const parts = String(prompt || "").split(/\n---\nUser reply:\n/);
  if (parts.length <= 1) return [];
  return parts
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean);
}

function mergePromptRepliesIntoTimeline(items, prompt) {
  const replies = extractUserRepliesFromPrompt(prompt);
  if (!replies.length) return items;

  const merged = items.slice();
  const existingUser = merged
    .filter((it) => it.type === "user")
    .map((it) => String(it.text || "").trim());

  const runIndices = merged
    .map((it, i) =>
      it.type === "system" && String(it.text || "").trim().startsWith("$ claude") ? i : -1,
    )
    .filter((i) => i >= 0);

  let insertOffset = 0;
  for (let ri = 0; ri < replies.length; ri++) {
    const reply = replies[ri];
    const hit = existingUser.some((t) => t.includes(reply) || reply.includes(t));
    if (hit) continue;
    const targetRun = runIndices[ri + 1];
    const insertAt = targetRun != null ? targetRun + insertOffset : merged.length;
    merged.splice(insertAt, 0, { type: "user", text: reply });
    insertOffset += 1;
  }
  return merged;
}

function isExecCommandTimelineItem(it) {
  return it.type === "system" && /^\$ \S/.test(String(it.text || "").trim());
}

const NOISE_SYSTEM_LABELS = new Set(["init", "turn_end"]);
const NOISE_ASSISTANT_RE = /^Reading additional input from stdin/i;

function isNoiseSystemTimelineItem(it) {
  if (it.type === "assistant" && NOISE_ASSISTANT_RE.test(String(it.text || "").trim())) return true;
  if (it.type !== "system") return false;
  const text = String(it.text || "").trim();
  if (isExecCommandTimelineItem(it)) return true;
  return NOISE_SYSTEM_LABELS.has(text);
}

function timelineForDisplay(raw, awaiting, prompt) {
  let items;
  if (LOG_TIMELINE_PARSER && raw === LOG_RESULT) {
    items = LOG_TIMELINE_PARSER.getItems().slice();
  } else {
    items = parseLogTimelineLocal(raw);
  }
  items = mergePromptRepliesIntoTimeline(items, prompt);
  if (awaiting) {
    // Gate card owns the decision UI; drop trailing gate blobs from the stream.
    while (items.length && items[items.length - 1].type === "gate") items.pop();
  }
  return items.filter((it) => !isNoiseSystemTimelineItem(it));
}

function scrollLogToBottom(force) {
  const scroll = document.getElementById("logScroll");
  if (!scroll) return;
  const apply = () => {
    const nearBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 48;
    if (force || nearBottom) scroll.scrollTop = scroll.scrollHeight;
  };
  if (force) {
    requestAnimationFrame(() => requestAnimationFrame(apply));
  } else {
    apply();
  }
}

function isRawLogNearBottom(body) {
  return body.scrollTop + body.clientHeight >= body.scrollHeight - 48;
}

function scrollRawLogToBottom(force) {
  const body = document.getElementById("logBody");
  if (!body) return;
  if (force) LOG_RAW_PIN_BOTTOM = true;
  if (force || LOG_RAW_PIN_BOTTOM || isRawLogNearBottom(body)) {
    body.scrollTop = body.scrollHeight;
    LOG_RAW_PIN_BOTTOM = true;
  }
}

function updateRawLogBody(text) {
  const body = document.getElementById("logBody");
  if (!body) return;
  const next = text || "(暂无输出)";
  const prevTop = body.scrollTop;
  if (body.textContent !== next) body.textContent = next;
  if (LOG_RAW_PIN_BOTTOM) body.scrollTop = body.scrollHeight;
  else body.scrollTop = prevTop;
}

function bindRawLogScroll() {
  const body = document.getElementById("logBody");
  if (!body || body.dataset.scrollBound) return;
  body.dataset.scrollBound = "1";
  body.addEventListener(
    "scroll",
    () => {
      if (LOG_VIEW_MODE !== "raw") return;
      LOG_RAW_PIN_BOTTOM = isRawLogNearBottom(body);
    },
    { passive: true },
  );
}

const RAW_DRAWER_WIDTH_KEY = "agent-desk.rawDrawerWidth";

function bindRawDrawerResize() {
  const drawer = document.getElementById("rawDrawer");
  if (!drawer || drawer.dataset.resizeBound) return;
  drawer.dataset.resizeBound = "1";
  try {
    const saved = localStorage.getItem(RAW_DRAWER_WIDTH_KEY);
    if (saved) drawer.style.width = saved;
  } catch {
    /* ignore */
  }

  const handle = document.createElement("div");
  handle.className = "raw-drawer-resize-handle";
  handle.title = "拖动调整宽度";
  handle.setAttribute("aria-hidden", "true");
  drawer.prepend(handle);

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.classList.add("dragging");
    const startX = e.clientX;
    const startW = drawer.getBoundingClientRect().width;
    const onMove = (ev) => {
      const next = Math.min(
        window.innerWidth * 0.96,
        Math.max(320, startW + (startX - ev.clientX)),
      );
      drawer.style.width = `${Math.round(next)}px`;
    };
    const onUp = () => {
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      try {
        localStorage.setItem(RAW_DRAWER_WIDTH_KEY, drawer.style.width);
      } catch {
        /* ignore */
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

function renderLogGateCard(gate, awaiting) {
  const card = document.getElementById("logGateCard");
  if (!card) return;
  if (!awaiting || !gate || !(gate.choices || []).length) {
    card.hidden = true;
    card.innerHTML = "";
    return;
  }
  card.hidden = false;
  const choices = gate.choices
    .map((c) => {
      const danger = isAbortChoice(c.label, c.value) ? " danger" : "";
      return `<button type="button" class="lg-choice${danger}" data-value="${esc(c.value)}">${esc(c.label || c.value)}</button>`;
    })
    .join("");
  card.innerHTML =
    `<p class="lg-title">${esc(gate.heading || "需要确认")}</p>` +
    `<p class="lg-hint">请选择一项以继续；也可在下方输入自定义回复。</p>` +
    `<div class="lg-choices">${choices}</div>`;
  card.querySelectorAll(".lg-choice").forEach((btn) => {
    btn.onclick = () => sendReply(btn.dataset.value);
  });
}

function logViewToggleSvg(isRaw) {
  const common = 'viewBox="0 0 24 24" fill="none" aria-hidden="true"';
  if (isRaw) {
    // chat bubble → switch back to session view
    return `<svg ${common}><path d="M5.5 6.5A2.5 2.5 0 018 4h8a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0116 16h-3.2L9 19.2V16H8A2.5 2.5 0 015.5 13.5v-7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }
  // code brackets → switch to raw view
  return `<svg ${common}><path d="M9 7.5L5.5 12 9 16.5M15 7.5L18.5 12 15 16.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function applyLogViewMode() {
  const toggle = document.getElementById("logViewToggle");
  const mask = document.getElementById("rawDrawerMask");
  const isRaw = LOG_VIEW_MODE === "raw";
  if (mask) {
    mask.hidden = !isRaw;
    mask.classList.toggle("show", isRaw);
  }
  if (toggle) {
    const label = isRaw ? "关闭原始" : "原始日志";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.classList.toggle("active", isRaw);
    toggle.innerHTML = logViewToggleSvg(isRaw);
  }
}

function openRawDrawer() {
  LOG_VIEW_MODE = "raw";
  LOG_RAW_PIN_BOTTOM = true;
  applyLogViewMode();
  scrollRawLogToBottom(true);
}

function closeRawDrawer() {
  if (LOG_VIEW_MODE !== "raw") return;
  LOG_VIEW_MODE = "timeline";
  applyLogViewMode();
}

function toggleLogView() {
  if (LOG_VIEW_MODE === "raw") closeRawDrawer();
  else openRawDrawer();
}

function renderLogTitle(status, title) {
  const name = (title || "").trim();
  const st = STATUS_LABEL[status] || status || "";
  if (name && st) return `${name}`;
  if (name) return name;
  return "任务会话";
}

function setLogTitleEl(status, title) {
  const el = document.getElementById("logTitle");
  const name = (title || "").trim();
  el.textContent = renderLogTitle(status, name);
  el.title = name || "";
}

function canContinueTask(t) {
  if (!t) return false;
  const st = (t.status || "").trim();
  if (st === "awaiting") return true;
  if (st === "stopped") return true;
  if (st !== "failed") return false;
  // Start-class failures need retry/start, not resume("继续") which pollutes prompt (#1).
  if (isStartClassFailure(t)) return false;
  return !!(tField(t, "sessionId", "session_id") || "").trim();
}

/** Missing CLI / backend / generic start errors — retry via /start, not /resume. */
function isStartClassFailure(t) {
  if (!t || (t.status || "").trim() !== "failed") return false;
  const code = String(tField(t, "failureCode", "failure_code") || "").trim();
  return code === "spawn_error" || code === "backend_unavailable" || code === "start_error";
}

function taskNeedsFreshStart(t) {
  if (!t) return false;
  const st = (t.status || "").trim();
  if (st === "created") return true;
  if (st !== "failed") return false;
  const hasSession = !!(tField(t, "sessionId", "session_id") || "").trim();
  return !hasSession || isStartClassFailure(t);
}

function failureFooterHint(task, failed) {
  if (!failed) return "可从标题栏继续会话";
  const code = String(tField(task, "failureCode", "failure_code") || "").trim();
  const msg = String(tField(task, "failureMessage", "failure_message") || "").trim();
  if (code === "spawn_error" || code === "backend_unavailable") {
    return (msg ? `${msg} · ` : "") + "请确认 Agent CLI 已安装并在 PATH 中，然后重试";
  }
  if (taskNeedsFreshStart(task)) return msg || "可重试启动";
  return msg || "可从标题栏继续会话";
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const hasBody = opts.body !== undefined && opts.body !== null;
  if (hasBody && !headers["content-type"] && !headers["Content-Type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(path, {
    ...opts,
    headers,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) throw new Error(data.error || data.message || res.statusText);
  return data;
}

async function loadHealth() {
  try {
    const h = await api("/api/health");
    document.getElementById("ver").textContent = h.version ? `v${h.version}` : "";
  } catch {
    document.getElementById("ver").textContent = "";
  }
}

async function loadTasks(showToast) {
  TASKS = await api("/api/tasks");
  TASK_POLL_SIG = taskListSignature(TASKS);
  updateAwaitingNavBadge(countAwaitingTasks(TASKS));
  renderTasks();
  if (showToast) toast(`已刷新 ${uiRootTasks().length} 条任务`);
}

function countAwaitingTasks(tasks) {
  return (tasks || []).filter((t) => (t.status || "") === "awaiting").length;
}

function setTaskFilter(filter, opts = {}) {
  const next = filter || "all";
  TASK_FILTER = next;
  TASK_PAGE = 1;
  document.querySelectorAll("#taskFilters .chip").forEach((c) => {
    c.classList.toggle("active", (c.dataset.filter || "all") === next);
  });
  const sel = document.getElementById("taskFilterSelect");
  if (sel && sel.value !== next) sel.value = next;
  if (opts.syncUrl !== false && CURRENT_VIEW === "tasks-list") {
    const u = new URL(location.href);
    if (next === "all") u.searchParams.delete("filter");
    else u.searchParams.set("filter", next);
    history.replaceState(null, "", u.pathname + u.search);
  }
  if (CURRENT_VIEW === "tasks-list") renderTasks();
}

function updateAwaitingNavBadge(count) {
  AWAITING_COUNT = Math.max(0, Number(count) || 0);
  const nav = document.querySelector('.nav-item[data-view="inbox"]');
  if (nav) {
    let badge = nav.querySelector(".nav-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      badge.setAttribute("aria-label", "待办数量");
      nav.appendChild(badge);
    }
    if (AWAITING_COUNT > 0) {
      badge.textContent = AWAITING_COUNT > 99 ? "99+" : String(AWAITING_COUNT);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
  const stat = document.getElementById("dash-awaiting-stat");
  if (stat) stat.classList.toggle("has-alert", AWAITING_COUNT > 0);
  const link = document.getElementById("dash-awaiting-link");
  if (link) {
    link.textContent =
      AWAITING_COUNT > 0 ? `查看待办 (${AWAITING_COUNT})` : "查看待办";
  }
}

function goToInbox() {
  switchView("inbox");
}

function openInboxTask(taskId) {
  openTaskView(taskId, { filter: "awaiting" });
}

/** Open a finished task from Inbox acceptance cards (not gate awaiting). */
function openInboxResultTask(taskId) {
  openTaskView(taskId, { filter: "done" });
}

function openInboxTaskWithReply(taskId, reply) {
  if (!taskId) return;
  DEEP_LINK_REPLY = String(reply || "").trim();
  DEEP_LINK_REPLY_SENT = false;
  openTaskView(taskId, { filter: "awaiting" });
}

function openTaskView(taskId, opts = {}) {
  if (!taskId) return;
  const filter = (opts.filter || "").trim();
  switchView("tasks-list", {
    taskId,
    filter: filter || undefined,
    resetFilter: opts.resetFilter,
  });
}

function openWorkflowRunTask(taskId, status) {
  if (!taskId) return;
  const st = String(status || "").trim();
  let filter;
  if (st === "awaiting") filter = "awaiting";
  else if (st === "running") filter = "running";
  else if (st === "failed" || st === "stopped") filter = "failed";
  openTaskView(taskId, { filter });
}

function goToAwaitingTasks(taskId) {
  const id = (taskId || "").trim();
  if (id) openTaskView(id, { filter: "awaiting" });
  else goToInbox();
}

function syncPageTitle(view) {
  const meta = VIEW_TITLES[view] || ["", ""];
  const page = (meta[0] || "").trim();
  document.title = page ? `${page} · agent-desk` : "agent-desk";
}

function isLogTaskActive(task) {
  if (!task) return false;
  const st = task.status || "";
  return st === "running" || st === "awaiting";
}

async function pollTasksQuiet() {
  const view = document.getElementById("view-tasks-list");
  if (!view || view.style.display === "none") return;
  try {
    const next = await api("/api/tasks");
    const sig = taskListSignature(next);
    if (sig === TASK_POLL_SIG) return;
    const prevStatus = new Map(TASKS.map((t) => [t.id, t.status || ""]));
    TASK_POLL_SIG = sig;
    TASKS = next;
    updateAwaitingNavBadge(countAwaitingTasks(TASKS));
    renderTasks();
    next.forEach((t) => {
      const was = prevStatus.get(t.id) || "";
      const now = t.status || "";
      if (now === "awaiting" && was === "running") {
        toast(`「${t.title || t.id}」等待确认，请前往待办处理`);
      }
      if (now === "queued" && was === "failed") {
        toast(`「${t.title || t.id}」已加入重试队列`);
      }
      if (now === "running" && was === "queued") {
        toast(`「${t.title || t.id}」开始重试`);
      }
      if (LOG_ID === t.id && now !== was) {
        void pollLog();
      }
    });
  } catch {
    /* ignore */
  }
}

function startTaskPolling() {
  stopTaskPolling();
  TASK_POLL_SIG = taskListSignature(TASKS);
  const tick = async () => {
    await pollTasksQuiet();
    const listView = document.getElementById("view-tasks-list");
    if (!listView || listView.style.display === "none") return;
    const ms = hasActiveTasks(TASKS) || LOG_ID ? 3000 : 10000;
    TASK_POLL_TIMER = setTimeout(tick, ms);
  };
  TASK_POLL_TIMER = setTimeout(tick, 3000);
}

function stopTaskPolling() {
  if (TASK_POLL_TIMER) {
    clearTimeout(TASK_POLL_TIMER);
    TASK_POLL_TIMER = null;
  }
}

function taskIconSvg(kind) {
  const common = 'viewBox="0 0 24 24" fill="none" aria-hidden="true"';
  if (kind === "play") {
    return `<svg ${common}><path d="M8 6.5v11l10-5.5L8 6.5z" fill="currentColor"/></svg>`;
  }
  if (kind === "stop") {
    return `<svg ${common}><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`;
  }
  if (kind === "log") {
    return `<svg ${common}><path d="M8 7h8M8 12h8M8 17h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="4.5" y="3.5" width="15" height="17" rx="2.5" stroke="currentColor" stroke-width="1.8"/></svg>`;
  }
  if (kind === "handle") {
    return `<svg ${common}><path d="M5.5 6.5A2.5 2.5 0 018 4h8a2.5 2.5 0 012.5 2.5v7A2.5 2.5 0 0116 16h-3.2L9 19.2V16H8A2.5 2.5 0 015.5 13.5v-7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }
  if (kind === "del") {
    return `<svg ${common}><path d="M9 10v7M12 10v7M15 10v7M5 7h14M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7M6.5 7l.8 12.2A1.5 1.5 0 008.8 20.5h6.4a1.5 1.5 0 001.5-1.3L17.5 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  return "";
}

function taskIconBtn({ act, id, kind, label, disabled }) {
  const cls = `tr-icon-btn tr-icon-${kind}`;
  const dis = disabled ? " disabled" : "";
  const actAttr = act ? ` data-act="${esc(act)}"` : "";
  const idAttr = id ? ` data-id="${esc(id)}"` : "";
  return (
    `<button type="button" class="${cls}"${actAttr}${idAttr}` +
    ` title="${esc(label)}" aria-label="${esc(label)}"${dis}>` +
    `${taskIconSvg(kind)}</button>`
  );
}

function renderKanbanCard(t) {
  const id = esc(t.id || "");
  const skill = esc(tField(t, "skill", "skill") || "default");
  const isShared = isSharedWorkflow(t);
  const isIndep = isIndependentWorkflow(t);
  const childCount = isIndep ? TASKS.filter((x) => tField(x, "parentTaskId", "parent_task_id") === t.id).length : 0;
  let typeTag = "";
  if (isShared) typeTag = '<span class="tag tag-mode-shared">共享</span> ';
  else if (isIndep) typeTag = '<span class="tag tag-mode-indep">独立</span> ';
  const title = esc(t.title || tField(t, "skill", "skill") || "-");
  const sub = childCount > 0 ? `<div class="kb-card-sub">${childCount} 个子步骤</div>` : "";
  return (
    `<div class="kb-card" data-act="log" data-id="${id}" title="查看日志 / 处理">` +
    `<div class="kb-card-title">${title}</div>${typeTag}` +
    `<span class="tag tag-skill ${skill}">${skill}</span>${sub}</div>`
  );
}

function renderListRow(t, opts = {}) {
  const isChild = !!opts.child;
  const id = esc(t.id || "");
  const skill = esc(tField(t, "skill", "skill") || "default");
  let skillLabel = esc(tField(t, "skill", "skill") || "-");
  if (isChild && opts.stepLabel) skillLabel = esc(opts.stepLabel);
  const title = esc(t.title || tField(t, "skill", "skill") || "-");
  const phaseLabel = esc(taskPhaseLabel(t));
  const issue = esc(tField(t, "issueCode", "issue_code") || "");
  const proj = esc(shortPath(tField(t, "projectDir", "project_dir")));
  const act = esc(fmtTime(t.lastActivityAt || t.last_activity_at || t.updatedAt || t.updated_at));
  const running = t.status === "running";
  const awaiting = t.status === "awaiting";
  const queued = t.status === "queued";
  const canContinue = canContinueTask(t);
  const needsFreshStart = taskNeedsFreshStart(t);
  const metaParts = [];
  if (!LOG_ID && proj && proj !== "-") metaParts.push(proj);
  if (issue) metaParts.push(`<span class="bug-code">${issue}</span>`);
  const wfName = String(tField(t, "workflowName", "workflow_name") || "").trim();
  const step = Number(tField(t, "workflowStep", "workflow_step") || 0);
  const total = Number(tField(t, "workflowStepTotal", "workflow_step_total") || 0);
  if (!isChild && wfName && total > 0) metaParts.push(`${esc(wfName)} · ${step}/${total}`);
  else if (!isChild && wfName) metaParts.push(esc(wfName));
  const retryHint = taskRetryHint(t);
  if (retryHint) metaParts.push(`<span class="tr-retry-hint">${esc(retryHint)}</span>`);
  metaParts.push(`活动 ${act}`);
  let ops = "";
  if (awaiting) {
    ops += taskIconBtn({ act: "log", id, kind: "handle", label: "处理" });
    ops += taskIconBtn({ act: "stop", id, kind: "stop", label: "停止" });
  } else if (running) {
    ops += taskIconBtn({ act: "stop", id, kind: "stop", label: "停止" });
  } else if (queued) {
    ops += taskIconBtn({ act: "stop", id, kind: "stop", label: "取消" });
  } else if (needsFreshStart) {
    ops += taskIconBtn({
      act: "start",
      id,
      kind: "play",
      label: t.status === "failed" ? "重试" : "运行",
    });
  } else if (canContinue) {
    ops += taskIconBtn({ act: "continue", id, kind: "play", label: "继续" });
  }
  ops += taskIconBtn({ act: "log", id, kind: "log", label: "日志" });
  if (!isChild) ops += taskIconBtn({ act: "del", id, kind: "del", label: "删除" });
  const hasChildren = !!opts.hasChildren;
  const expanded = !!opts.expanded;
  const expandBtn = hasChildren
    ? `<button type="button" class="tr-expand${expanded ? " open" : ""}" data-act="toggle-group" data-id="${id}" title="展开/收起" aria-label="展开/收起">▸</button>`
    : '<span class="tr-expand-spacer"></span>';
  const modeTag = !isChild && isSharedWorkflow(t)
    ? '<span class="tag tag-mode-shared">共享</span> '
    : !isChild && isIndependentWorkflow(t)
      ? '<span class="tag tag-mode-indep">独立</span> '
      : "";
  const tagClass = isChild ? "tag tag-step" : `tag tag-skill ${skill}`;
  const selected = LOG_ID && String(t.id) === String(LOG_ID);
  const rowClass = `task-row${isChild ? " task-row-child" : hasChildren ? " task-row-parent" : ""}${selected ? " selected" : ""}`;
  const phase = esc(taskPhase(t));
  return (
    `<div class="${rowClass}" data-task-id="${id}">` +
    `<div class="tr-tag">${expandBtn}${modeTag}<span class="${tagClass}">${skillLabel}</span></div>` +
    `<div class="tr-main"><div class="tr-title" title="${title}">${title}</div>` +
    `<div class="tr-meta">${metaParts.join(" · ")}</div></div>` +
    `<div class="tr-status" data-status="${phase}" title="${phaseLabel}">${phaseLabel}</div>` +
    `<div class="tr-actions">${ops}</div></div>`
  );
}

function renderTaskGroup(group) {
  const parent = group.parent;
  const children = group.children || [];
  const pid = parent.id || "";
  const expanded = isGroupExpanded(pid, children);
  const total = children.length || Number(tField(parent, "workflowStepTotal", "workflow_step_total")) || 0;
  let html = '<div class="task-group">';
  html += renderListRow(parent, { hasChildren: children.length > 0, expanded });
  if (children.length && expanded) {
    html += '<div class="task-children">';
    children.forEach((ch, i) => {
      html += renderListRow(ch, { child: true, stepLabel: childStepLabel(ch, i, total) });
    });
    html += "</div>";
  }
  html += "</div>";
  return html;
}

function renderTaskPager(total, page, pageSize) {
  const pager = document.getElementById("taskPager");
  if (!pager) return;
  if (!total) {
    pager.innerHTML = "";
    return;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pages);
  if (pages <= 1) {
    pager.innerHTML = `<span class="task-pager-info">共 ${total} 条</span>`;
    return;
  }
  const from = (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);
  pager.innerHTML =
    `<span class="task-pager-info">共 ${total} 条，当前 ${from}–${to}</span>` +
    `<button type="button" id="taskPgPrev"${cur <= 1 ? " disabled" : ""}>上一页</button>` +
    `<span class="pg-num">${cur} / ${pages}</span>` +
    `<button type="button" id="taskPgNext"${cur >= pages ? " disabled" : ""}>下一页</button>`;
  const prev = document.getElementById("taskPgPrev");
  const next = document.getElementById("taskPgNext");
  if (prev) prev.onclick = () => {
    TASK_PAGE = cur - 1;
    renderTasks();
  };
  if (next) next.onclick = () => {
    TASK_PAGE = cur + 1;
    renderTasks();
  };
}

function bindTaskActs(root) {
  if (!root) return;
  root.querySelectorAll("[data-act]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      const act = el.dataset.act;
      if (act === "toggle-ws") {
        const key = el.dataset.ws || "";
        if (COLLAPSED_WORKSPACES.has(key)) COLLAPSED_WORKSPACES.delete(key);
        else COLLAPSED_WORKSPACES.add(key);
        renderTasks();
        return;
      }
      if (act === "toggle-group") {
        if (EXPANDED_TASK_GROUPS.has(id)) EXPANDED_TASK_GROUPS.delete(id);
        else EXPANDED_TASK_GROUPS.add(id);
        renderTasks();
        return;
      }
      if (act === "continue") continueTask(id);
      else if (act === "start") runTask(id);
      else if (act === "stop") stopTask(id);
      else if (act === "del") deleteTask(id);
      else if (act === "log") showLog(id);
    });
  });
  root.querySelectorAll(".task-row[data-task-id]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-act],button,a,input")) return;
      // Only switch tasks while session pane is already open.
      if (!LOG_ID) return;
      const id = el.dataset.taskId;
      if (id) showLog(id);
    });
  });
}

function ensureWorkspaceExpandedForTask(taskId) {
  const t = TASKS.find((x) => x.id === taskId);
  if (!t) return;
  const root = isChildTask(t) ? getParentTask(t) || t : t;
  const key = workspaceKeyOf(root);
  COLLAPSED_WORKSPACES.delete(key);
  if (isChildTask(t) && root && root.id) EXPANDED_TASK_GROUPS.add(root.id);
}

function renderTasks() {
  const boardTasks = uiRootTasks();
  BOARD_PHASES.forEach((phase) => {
    const box = document.getElementById(`kb-${phase}`);
    if (!box) return;
    const items = boardTasks.filter((t) => taskPhase(t) === phase);
    box.innerHTML = items.length ? items.map(renderKanbanCard).join("") : '<div class="kb-empty">暂无</div>';
  });

  const list = document.getElementById("task-list");
  if (!list) return;
  const allGroups = buildTaskGroups(TASKS).filter(groupMatchesFilter);
  const total = allGroups.length;
  const pages = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));
  if (TASK_PAGE > pages) TASK_PAGE = pages;
  if (TASK_PAGE < 1) TASK_PAGE = 1;
  const start = (TASK_PAGE - 1) * TASK_PAGE_SIZE;
  const groups = allGroups.slice(start, start + TASK_PAGE_SIZE);
  if (!TASKS.length) {
    list.innerHTML = '<div class="task-empty">暂无任务,去「新建任务」创建一个吧</div>';
    renderTaskPager(0, 1, TASK_PAGE_SIZE);
  } else if (!total) {
    list.innerHTML = '<div class="task-empty">当前筛选下暂无任务</div>';
    renderTaskPager(0, 1, TASK_PAGE_SIZE);
  } else if (LOG_ID) {
    const sections = buildWorkspaceSections(groups);
    list.innerHTML = sections.map(renderWorkspaceSection).join("");
    renderTaskPager(total, TASK_PAGE, TASK_PAGE_SIZE);
  } else {
    list.innerHTML = groups.map(renderTaskGroup).join("");
    renderTaskPager(total, TASK_PAGE, TASK_PAGE_SIZE);
  }
  bindTaskActs(document.getElementById("view-tasks-list"));
}

document.getElementById("taskFilters").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  setTaskFilter(btn.dataset.filter || "all");
});

const taskFilterSelect = document.getElementById("taskFilterSelect");
if (taskFilterSelect) {
  taskFilterSelect.addEventListener("change", () => {
    setTaskFilter(taskFilterSelect.value || "all");
  });
}

const taskBoardToggle = document.getElementById("taskBoardToggle");
if (taskBoardToggle) {
  taskBoardToggle.addEventListener("click", () => {
    document.getElementById("taskBoard")?.classList.toggle("collapsed");
  });
  taskBoardToggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      document.getElementById("taskBoard")?.classList.toggle("collapsed");
    }
  });
}

async function stopTask(id) {
  if (!id) return;
  if (!confirm("确定停止该任务？正在执行的 Agent 将被中断。")) return;
  try {
    await api(`/api/tasks/${encodeURIComponent(id)}/stop`, { method: "POST" });
    toast("已停止任务");
    await loadTasks();
    if (LOG_ID === id) await pollLog();
  } catch (e) {
    toast(`停止失败: ${e.message || e}`);
  }
}

async function runTask(id) {
  if (!id || LOG_TASK_ACTION_BUSY || LOG_REPLY_SENDING) return;
  LOG_TASK_ACTION_BUSY = true;
  try {
    await api(`/api/tasks/${encodeURIComponent(id)}/start`, { method: "POST" });
    toast("已开始运行");
    await loadTasks();
    if (LOG_ID === id || !LOG_ID) openLogStream(id);
    showLog(id);
  } catch (e) {
    toast(`运行失败: ${e.message || e}`);
    await loadTasks();
    if (LOG_ID === id) await pollLog();
  } finally {
    LOG_TASK_ACTION_BUSY = false;
  }
}

async function continueTask(id) {
  if (!id || LOG_TASK_ACTION_BUSY || LOG_REPLY_SENDING) return;
  LOG_TASK_ACTION_BUSY = true;
  try {
    await api(`/api/tasks/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      body: JSON.stringify({ reply: "继续", model: getReplyModel() }),
    });
    toast("已继续本次会话");
    await loadTasks();
    if (LOG_ID === id || !LOG_ID) openLogStream(id);
    showLog(id);
  } catch (e) {
    toast(`继续失败: ${e.message || e}`);
    if (LOG_ID === id) await pollLog();
  } finally {
    LOG_TASK_ACTION_BUSY = false;
  }
}

async function deleteTask(id) {
  if (!id || !confirm("确定删除该任务？")) return;
  try {
    await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("已删除");
    if (LOG_ID === id) closeLog();
    await loadTasks();
  } catch (e) {
    toast(`删除失败: ${e.message || e}`);
  }
}

function renderReplyChoices(choices) {
  const box = document.getElementById("replyChoices");
  if (!choices.length) {
    box.classList.remove("show");
    box.innerHTML = "";
    return;
  }
  box.classList.add("show");
  box.innerHTML = choices
    .map(
      (c) =>
        `<button type="button" class="reply-chip" data-value="${esc(c.value)}">${esc(c.label || c.value)}</button>`,
    )
    .join("");
  box.querySelectorAll(".reply-chip").forEach((btn) => {
    btn.onclick = () => sendReply(btn.dataset.value);
  });
}

function timelineRenderSig(timeline) {
  if (!timeline.length) return "0";
  const parts = timeline.map((it) => {
    if (it.type === "activity") {
      return `a:${it.id || ""}:${it.status || ""}:${String(it.text || "").length}`;
    }
    return `${it.type}:${String(it.text || "").length}`;
  });
  return `${timeline.length}|${parts.join(",")}`;
}

function startActivityTicker() {
  stopActivityTicker();
  LOG_ACTIVITY_TICKER = setInterval(() => {
    if (LOG_TASK_STATUS !== "running" || !LOG_ID) return;
    const timeline = LOG_TIMELINE_PARSER
      ? LOG_TIMELINE_PARSER.getItems().slice()
      : timelineForDisplay(LOG_RESULT, false, "");
    const task = TASKS.find((t) => t.id === LOG_ID);
    updateLogActivityFooter(true, timeline, task);
  }, 1000);
}

function stopActivityTicker() {
  if (LOG_ACTIVITY_TICKER) {
    clearInterval(LOG_ACTIVITY_TICKER);
    LOG_ACTIVITY_TICKER = 0;
  }
}

function markLogStreamActivity() {
  LOG_LAST_STREAM_AT = Date.now();
}

function updateLogLiveBadge(connected) {
  LOG_SSE_OPEN = !!connected;
  if (connected) {
    LOG_SSE_OPEN_AT = Date.now();
    LOG_SSE_CLOSED_AT = 0;
  }
  // Connection copy lives in the sticky activity footer (avoid header duplicate).
  const el = document.getElementById("logLiveBadge");
  if (el) el.hidden = true;
}

function clearLogSseRetry() {
  if (LOG_SSE_RETRY_TIMER) {
    clearTimeout(LOG_SSE_RETRY_TIMER);
    LOG_SSE_RETRY_TIMER = 0;
  }
}

function closeLogStream() {
  clearLogSseRetry();
  if (LOG_SSE) {
    LOG_SSE.close();
    LOG_SSE = null;
  }
  LOG_SSE_TASK = "";
  LOG_SSE_CONNECT_AT = 0;
  LOG_STREAM_PATCH_LEN = 0;
  updateLogLiveBadge(false);
}

function isLogStreamStatus(status) {
  return status === "running" || status === "awaiting";
}

function updateLogStream(taskOrStatus) {
  const status = typeof taskOrStatus === "string" ? taskOrStatus : taskOrStatus?.status || "";
  if (!LOG_ID || !isLogStreamStatus(status)) {
    closeLogStream();
    return;
  }
  if (LOG_SSE && LOG_SSE_TASK === LOG_ID) return;
  openLogStream(LOG_ID);
}

function scheduleLogStreamRetry(id) {
  clearLogSseRetry();
  if (!id || LOG_ID !== id || !isLogStreamStatus(LOG_TASK_STATUS)) return;
  LOG_SSE_RETRY_TIMER = setTimeout(() => {
    LOG_SSE_RETRY_TIMER = 0;
    if (LOG_ID === id && isLogStreamStatus(LOG_TASK_STATUS)) openLogStream(id);
  }, 2000);
}

function cancelStreamRender() {
  LOG_STREAM_EPOCH += 1;
  if (LOG_STREAM_RENDER_RAF) {
    cancelAnimationFrame(LOG_STREAM_RENDER_RAF);
    LOG_STREAM_RENDER_RAF = 0;
  }
  LOG_STREAM_PENDING = null;
}

function openLogStream(id) {
  closeLogStream();
  if (!id || typeof EventSource === "undefined") return;
  LOG_SSE_TASK = id;
  LOG_SSE_CONNECT_AT = Date.now();
  LOG_SSE_OPEN_AT = 0;
  // Keep LOG_SSE_CLOSED_AT across reconnect attempts so "连接中断" can accumulate ≥8s.
  // Cleared only when SSE opens successfully (updateLogLiveBadge(true)).
  const offset = LOG_RESULT_LEN > 0 ? `?offset=${LOG_RESULT_LEN}` : "";
  const es = new EventSource(`/api/tasks/${encodeURIComponent(id)}/stream${offset}`);
  LOG_SSE = es;
  es.onopen = () => {
    if (LOG_ID !== id) return;
    updateLogLiveBadge(true);
  };
  es.onmessage = (ev) => {
    if (LOG_ID !== id) return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "end") {
        if (LOG_TIMELINE_PARSER) LOG_TIMELINE_PARSER.finalize();
        cancelStreamRender();
        stopActivityTicker();
        closeLogStream();
        LOG_RENDER_SIG = "";
        void pollLog();
        return;
      }
      if (msg.type === "snapshot" || msg.type === "update") {
        markLogStreamActivity();
        const merged = mergeStreamTask(msg.task || {}, msg.resultAppend);
        scheduleStreamRender(merged, { fromStream: true });
      }
    } catch {
      /* ignore */
    }
  };
  es.onerror = () => {
    LOG_SSE_CLOSED_AT = Date.now();
    closeLogStream();
    const cached = TASKS.find((t) => t.id === LOG_ID);
    if (cached && !isLogTaskActive(cached)) {
      LOG_RENDER_SIG = "";
      void pollLog();
      return;
    }
    scheduleLogStreamRetry(id);
  };
}

function scheduleStreamRender(task, opts = {}) {
  const epoch = LOG_STREAM_EPOCH;
  LOG_STREAM_PENDING = { task, opts, epoch };
  if (LOG_STREAM_RENDER_RAF) return;
  LOG_STREAM_RENDER_RAF = requestAnimationFrame(() => {
    LOG_STREAM_RENDER_RAF = 0;
    const pending = LOG_STREAM_PENDING;
    LOG_STREAM_PENDING = null;
    if (pending && pending.epoch === LOG_STREAM_EPOCH) {
      void renderLogTask(pending.task, pending.opts);
    }
  });
}

function tryPatchStreamingTimeline(timeline, running) {
  if (!running || LOG_VIEW_MODE === "raw" || !timeline.length) return false;
  const box = document.getElementById("logTimeline");
  if (!box) return false;
  const last = timeline[timeline.length - 1];
  if (last.type !== "assistant" || timeline.length !== LOG_STREAM_PATCH_LEN) return false;

  const text = String(last.text || "");
  const el =
    box.querySelector(".log-item.assistant.is-streaming .li-body") ||
    box.querySelector(".log-item.assistant:last-child .li-body");
  if (!el) return false;
  if (el.dataset.streamText !== text) {
    el.dataset.streamText = text;
    el.innerHTML = renderLogBodyHtml("assistant", text);
    scrollLogToBottom(true);
  }
  return true;
}

function logConnectionHintHtml() {
  if (LOG_SSE_OPEN) {
    return '<span class="log-thinking-live">实时</span>';
  }
  const now = Date.now();
  if (LOG_SSE_CLOSED_AT) {
    const downSec = Math.floor((now - LOG_SSE_CLOSED_AT) / 1000);
    if (downSec < 8) {
      return '<span class="log-thinking-live is-reconnect">重新连接…</span>';
    }
    return '<span class="log-thinking-live is-down">连接中断，任务可能仍在运行</span>';
  }
  const attemptAt = LOG_SSE_CONNECT_AT || LOG_RUN_STARTED_AT || now;
  const waitMs = now - attemptAt;
  if (waitMs < 3000) {
    return '<span class="log-thinking-live is-reconnect">正在连接…</span>';
  }
  return '<span class="log-thinking-live is-reconnect">重新连接…</span>';
}

function setLogSessionFooterVisible(show) {
  const footer = document.getElementById("logSessionFooter");
  if (footer) footer.hidden = !show;
}

function updateLogActivityFooter(running, timeline, task) {
  const el = document.getElementById("logThinking");
  if (!el) return;
  const status = (task && task.status) || LOG_TASK_STATUS || "";
  const failed = status === "failed";
  const stopped = status === "stopped";

  if (!running && !failed && !stopped) {
    el.hidden = true;
    el.classList.remove("is-error");
    setLogSessionFooterVisible(false);
    return;
  }

  el.hidden = false;
  setLogSessionFooterVisible(true);
  el.classList.toggle("is-error", failed);

  if (failed || stopped) {
    const code = String((task && tField(task, "failureCode", "failure_code")) || "").trim();
    const title = failed
      ? FAILURE_CODE_LABEL[code] || code || "任务失败"
      : "任务已停止";
    const sub = failureFooterHint(task, failed);
    const busy = LOG_TASK_ACTION_BUSY || LOG_REPLY_SENDING;
    let actions = "";
    if (failed && task && taskNeedsFreshStart(task)) {
      actions = `<div class="log-thinking-actions"><button type="button" class="log-thinking-action" ${busy ? "disabled" : ""} onclick="runTask(LOG_ID)">重试</button></div>`;
    } else if ((failed && task && canContinueTask(task)) || stopped) {
      actions = `<div class="log-thinking-actions"><button type="button" class="log-thinking-action" ${busy ? "disabled" : ""} onclick="continueTask(LOG_ID)">继续</button></div>`;
    }
    el.innerHTML = `<div class="log-thinking-inner">
      <div class="log-thinking-copy">
        <div class="log-thinking-title">${esc(title)}</div>
        <div class="log-thinking-sub">${esc(sub)}</div>
        ${actions}
      </div>
    </div>`;
    return;
  }

  const now = Date.now();
  const elapsed = LOG_RUN_STARTED_AT ? Math.max(1, Math.floor((now - LOG_RUN_STARTED_AT) / 1000)) : 0;
  const staleSec = LOG_LAST_STREAM_AT ? Math.floor((now - LOG_LAST_STREAM_AT) / 1000) : 0;
  const activities = (timeline || []).filter((it) => it.type === "activity");
  const runningAct = [...activities].reverse().find((a) => a.status === "running");
  const lastAct = activities[activities.length - 1];
  let label = "Agent 正在思考…";
  if (runningAct) label = runningAct.text;
  else if (lastAct) label = lastAct.text;
  const staleHint =
    staleSec >= 8 ? `<span class="log-thinking-stale">${staleSec}s 无新输出，可能仍在执行</span>` : "";
  const liveHint = logConnectionHintHtml();
  const downLong =
    !LOG_SSE_OPEN &&
    LOG_SSE_CLOSED_AT &&
    Math.floor((now - LOG_SSE_CLOSED_AT) / 1000) >= 8;
  const refreshAction = downLong
    ? `<div class="log-thinking-actions"><button type="button" class="log-thinking-action" onclick="openLogStream(LOG_ID)">刷新连接</button></div>`
    : "";
  el.innerHTML = `<div class="log-thinking-inner">
    <span class="log-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
  <div class="log-thinking-copy">
    <div class="log-thinking-title">${esc(label)}</div>
    <div class="log-thinking-sub">已运行 ${elapsed}s · ${liveHint}${staleHint ? ` · ${staleHint}` : ""}</div>
    ${refreshAction}
  </div>
</div>`;
}

function fitReplyInputHeight(input) {
  const el = input || document.getElementById("replyInput");
  if (!el) return;
  el.style.height = "auto";
  const max = 120;
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 36), max)}px`;
}

function updateReplyComposerState(running, canChat) {
  const rb = document.getElementById("replyBox");
  const input = document.getElementById("replyInput");
  const sendBtn = document.getElementById("logSendBtn");
  const busy = running || LOG_REPLY_SENDING;
  const show = canChat && !busy;
  if (rb) rb.classList.toggle("show", show);
  if (input) {
    input.disabled = busy;
    input.placeholder = LOG_REPLY_SENDING
      ? "正在发送，请稍候…"
      : "继续本次会话，Enter 发送，Shift+Enter 换行…";
    if (!busy && show) fitReplyInputHeight(input);
  }
  if (sendBtn) sendBtn.disabled = busy;
  document.querySelectorAll(".reply-chip, .lg-choice").forEach((btn) => {
    btn.disabled = busy;
  });
}

async function dispatchReply(reply, model) {
  if (!LOG_ID || !reply) return;
  if (LOG_REPLY_SENDING || LOG_TASK_STATUS === "running") return;
  LOG_REPLY_SENDING = true;
  LOG_PENDING_USER = reply;
  LOG_RENDER_SIG = "";
  updateReplyComposerState(true, false);
  try {
    const cur = TASKS.find((t) => t.id === LOG_ID);
    const previewTimeline = timelineForDisplay((cur && cur.result) || "", false, cur && cur.prompt);
    renderLogTimeline(previewTimeline);
    scrollLogToBottom(true);
    LOG_RUN_STARTED_AT = Date.now();
    LOG_LAST_STREAM_AT = Date.now();
    updateLogActivityFooter(true, previewTimeline);
    startActivityTicker();
  } catch {
    /* ignore */
  }
  try {
    await api(`/api/tasks/${encodeURIComponent(LOG_ID)}/resume`, {
      method: "POST",
      body: JSON.stringify({ reply, model: model || getReplyModel() }),
    });
    // Optimistically lock until stream/poll reports running (or terminal).
    LOG_TASK_STATUS = "running";
    toast("已发送");
    await loadTasks();
    await pollLog();
  } catch (e) {
    LOG_PENDING_USER = "";
    stopActivityTicker();
    updateLogActivityFooter(false, []);
    toast(`发送失败: ${e.message || e}`);
    await pollLog();
  } finally {
    LOG_REPLY_SENDING = false;
    const cur = TASKS.find((t) => t.id === LOG_ID);
    const st = (cur && cur.status) || LOG_TASK_STATUS || "";
    const running = st === "running" || st === "queued" || st === "created";
    const canChat = !running && ["awaiting", "done", "failed", "stopped"].includes(st);
    updateReplyComposerState(st === "running", canChat);
  }
}

async function sendReply(preset) {
  if (!LOG_ID || LOG_TASK_STATUS === "running" || LOG_REPLY_SENDING) return;
  const input = document.getElementById("replyInput");
  const reply = (preset || input.value || "").trim();
  if (!reply) return;

  if (!preset) {
    input.value = "";
    fitReplyInputHeight(input);
  }
  await dispatchReply(reply, getReplyModel());
}

function isImeComposingKeyEvent(e) {
  if (e.isComposing) return true;
  // Candidate selection in some IMEs (e.g. macOS Pinyin) uses keyCode 229.
  if (e.keyCode === 229) return true;
  return false;
}

function onReplyKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    if (isImeComposingKeyEvent(e)) return;
    e.preventDefault();
    sendReply();
  }
}

async function renderLogTask(d, opts = {}) {
  if (!LOG_ID || !d) return;
  const fromStream = !!opts.fromStream;
  const raw = d.result || "";
  if (!fromStream && raw !== LOG_RESULT) resetLogBuffer(raw);
  const prevStatus = LOG_TASK_STATUS;
  const running = d.status === "running";
  const awaiting = d.status === "awaiting";
  const gate = awaiting ? parseGate(raw) : null;

  LOG_TASK_STATUS = d.status;
  if (running && prevStatus !== "running") {
    LOG_RUN_STARTED_AT = Date.now();
    LOG_LAST_STREAM_AT = Date.now();
    startActivityTicker();
  } else if (!running) {
    stopActivityTicker();
  }
  if (fromStream) markLogStreamActivity();

  if (fromStream && !running && prevStatus === "running") {
    LOG_RENDER_SIG = "";
  }

  if (LOG_PENDING_USER && raw.includes(LOG_PENDING_USER)) {
    LOG_PENDING_USER = "";
  }

  const timeline = timelineForDisplay(raw, awaiting, d.prompt);
  updateLogActivityFooter(running, timeline, d);

  const sig = [
    d.status,
    raw.length,
    timelineRenderSig(timeline),
    LOG_VIEW_MODE,
    LOG_PENDING_USER,
    gate ? gate.heading : "",
    (gate && gate.choices && gate.choices.length) || 0,
  ].join("|");

  if (fromStream && running && tryPatchStreamingTimeline(timeline, running)) {
    const body = document.getElementById("logBody");
    if (body) updateRawLogBody(raw);
    updateLogActivityFooter(running, timeline, d);
    return;
  }

  if (!fromStream) {
    setLogTitleEl(d.status, d.title || LOG_TITLE);
    if (d.title) LOG_TITLE = d.title;
    const rawTitle = document.getElementById("rawDrawerTitle");
    if (rawTitle) {
      const name = String(d.title || LOG_TITLE || "").trim();
      rawTitle.textContent = name ? `${name} · 原始日志` : "原始日志";
    }
    renderLogMeta(d);
    renderLogTaskDetail(d);
    void ensureReplyModelDropdown(d);
    renderLogGateCard(gate, awaiting);
    applyLogViewMode();
  } else if (sig !== LOG_RENDER_SIG) {
    setLogTitleEl(d.status, d.title || LOG_TITLE);
    renderLogMeta(d);
    renderLogTaskDetail(d);
    renderLogGateCard(gate, awaiting);
  }

  const body = document.getElementById("logBody");
  if (body) updateRawLogBody(raw);
  if (sig !== LOG_RENDER_SIG) {
    LOG_RENDER_SIG = sig;
    LOG_STREAM_PATCH_LEN = timeline.length;
    renderLogTimeline(timeline);
    if (LOG_VIEW_MODE !== "raw") {
      const pinBottom = LOG_SCROLL_TO_BOTTOM || running;
      scrollLogToBottom(pinBottom);
      if (pinBottom && !running) LOG_SCROLL_TO_BOTTOM = false;
    }
  }

  const refreshChrome = !fromStream || !running;
  if (refreshChrome) {
    const stopBtn = document.getElementById("logStopBtn");
    if (stopBtn) stopBtn.style.display = running || awaiting ? "" : "none";

    const contBtn = document.getElementById("logContinueBtn");
    if (contBtn) {
      const showStart = !running && taskNeedsFreshStart(d);
      const showCont = !running && canContinueTask(d) && !awaiting && !showStart;
      contBtn.style.display = showStart || showCont ? "" : "none";
      contBtn.disabled = LOG_TASK_ACTION_BUSY || LOG_REPLY_SENDING;
      const contLabel = showStart ? (d.status === "failed" ? "重试" : "运行") : "继续";
      contBtn.title = contLabel;
      contBtn.setAttribute("aria-label", contLabel);
      const contText = document.getElementById("logContinueBtnText");
      if (contText) contText.textContent = contLabel;
      contBtn.onclick = showStart ? () => runTask(LOG_ID) : () => continueTask(LOG_ID);
    }

    const canChat = !running && ["awaiting", "done", "failed", "stopped", "created"].includes(d.status);
    updateReplyComposerState(running, canChat);

    if (awaiting && gate && (gate.choices || []).length) {
      LOG_CHOICES_KEY = "";
      renderReplyChoices([]);
    } else {
      const nextChoices = gate && gate.choices.length ? gate.choices : [];
      const nextKey = JSON.stringify(nextChoices);
      if (nextKey !== LOG_CHOICES_KEY) {
        LOG_CHOICES_KEY = nextKey;
        renderReplyChoices(nextChoices);
      }
    }

    await refreshLogWorkflowSteps(d);

    if (DEEP_LINK_REPLY && !DEEP_LINK_REPLY_SENT && awaiting && !running) {
      DEEP_LINK_REPLY_SENT = true;
      const autoReply = DEEP_LINK_REPLY;
      DEEP_LINK_REPLY = "";
      const u = new URL(location.href);
      u.searchParams.delete("reply");
      history.replaceState(null, "", u.pathname + u.search);
      setTimeout(() => sendReply(autoReply), 200);
    }
  }

  updateLogStream(running || awaiting);
}

async function pollLog() {
  if (!LOG_ID) return;
  try {
    cancelStreamRender();
    const d = await api(`/api/tasks/${encodeURIComponent(LOG_ID)}`);
    const nextResult = d.result || "";
    const alreadySynced = nextResult === LOG_RESULT;
    if (!alreadySynced) {
      LOG_RENDER_SIG = "";
      resetLogBuffer(nextResult);
    }
    await renderLogTask(d);
  } catch (e) {
    const body = document.getElementById("logBody");
    const timeline = document.getElementById("logTimeline");
    const msg = e.message || String(e);
    if (body) body.textContent = msg;
    if (timeline) timeline.innerHTML = `<div class="log-empty">${esc(msg)}</div>`;
  }
}

function setSessionPanelVisible(open) {
  const onTasks = CURRENT_VIEW === "tasks-list";
  const view = document.getElementById("view-tasks-list");
  // Always fill-height on tasks page so the empty right pane stays usable.
  if (view) view.classList.toggle("session-mode", onTasks);
  const split = document.querySelector("#view-tasks-list .task-split");
  if (split) split.classList.toggle("session-open", !!open);
  const board = document.getElementById("taskBoard");
  // With a task open: collapse board to free height for the session.
  if (board) board.classList.toggle("collapsed", !!open);
  const main = document.querySelector(".main");
  if (main) main.classList.toggle("tasks-fill", onTasks);
  const inner = document.querySelector(".main-inner");
  if (inner) inner.classList.toggle("tasks-session", onTasks);
  const panel = document.getElementById("sessionPanel");
  if (panel) {
    panel.hidden = !open;
    panel.classList.toggle("is-active-session", !!open);
  }
  const empty = document.getElementById("sessionEmpty");
  if (empty) empty.hidden = !!open;
}

function showLog(id) {
  if (!id) return;
  if (CURRENT_VIEW !== "tasks-list") switchView("tasks-list");
  const switching = LOG_ID !== id;
  LOG_ID = id;
  if (switching) {
    void loadAgentProfiles().then(() => refreshAgentProviderCache());
    LOG_TITLE = "";
    LOG_CHOICES_KEY = "";
    LOG_RENDER_SIG = "";
    LOG_PENDING_USER = "";
    LOG_REPLY_SENDING = false;
    LOG_TASK_ACTION_BUSY = false;
    LOG_REPLY_MODEL_KEY = "";
    LOG_TASK_STATUS = "";
    LOG_RESULT = "";
    LOG_RESULT_LEN = 0;
    LOG_TIMELINE_PARSER = null;
    LOG_SSE_CONNECT_AT = 0;
    LOG_SSE_OPEN_AT = 0;
    LOG_SSE_CLOSED_AT = 0;
    stopActivityTicker();
    updateLogActivityFooter(false, []);
    closeLogStream();
    LOG_SCROLL_TO_BOTTOM = true;
    LOG_VIEW_MODE = "timeline";
    LOG_RAW_PIN_BOTTOM = true;
    clearLogWorkflowSteps();
    const input = document.getElementById("replyInput");
    if (input) {
      input.value = "";
      fitReplyInputHeight(input);
    }
    const meta = document.getElementById("logMeta");
    if (meta) meta.innerHTML = "";
    const gate = document.getElementById("logGateCard");
    if (gate) {
      gate.hidden = true;
      gate.innerHTML = "";
    }
    const timeline = document.getElementById("logTimeline");
    if (timeline) timeline.innerHTML = '<div class="log-empty">加载中…</div>';
  }
  ensureWorkspaceExpandedForTask(id);
  setSessionPanelVisible(true);
  applyLogViewMode();
  renderTasks();
  pollLog();
}

function clearLogWorkflowSteps() {
  LOG_WF_RUN_ID = "";
  LOG_WF_CACHE = null;
  const el = document.getElementById("logWfSteps");
  if (el) {
    el.hidden = true;
    el.innerHTML = "";
  }
}

function renderLogWorkflowSteps(run, task) {
  const el = document.getElementById("logWfSteps");
  if (!el) return;
  const nodes = (run && run.nodes) || [];
  if (!nodes.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const curIdx = Number(run.currentIndex || 0);
  const step = Number(tField(task, "workflowStep", "workflow_step") || 0);
  el.hidden = false;
  el.innerHTML = nodes
    .map((n, i) => {
      const st = String(n.status || "pending");
      const isCurrent =
        st === "running" ||
        st === "awaiting" ||
        (run.status === "running" && i === curIdx) ||
        (step > 0 && i === step - 1 && (st === "running" || st === "awaiting" || st === "pending"));
      const label = esc(n.title || n.skill || `步骤 ${i + 1}`);
      return `<span class="log-wf-step ${esc(st)}${isCurrent ? " current" : ""}" title="${label} · ${esc(st)}">${label}</span>`;
    })
    .join("");
}

async function refreshLogWorkflowSteps(task) {
  const runId = String(tField(task, "workflowRunId", "workflow_run_id") || "").trim();
  if (!runId) {
    clearLogWorkflowSteps();
    return;
  }
  try {
    if (runId !== LOG_WF_RUN_ID || !LOG_WF_CACHE) {
      LOG_WF_CACHE = await api(`/api/workflow-runs/${encodeURIComponent(runId)}`);
      LOG_WF_RUN_ID = runId;
    } else if (task.status === "running" || task.status === "awaiting") {
      LOG_WF_CACHE = await api(`/api/workflow-runs/${encodeURIComponent(runId)}`);
    }
    renderLogWorkflowSteps(LOG_WF_CACHE, task);
  } catch {
    /* keep previous strip if any */
  }
}

function closeLog() {
  LOG_ID = null;
  LOG_RENDER_SIG = "";
  LOG_PENDING_USER = "";
  LOG_REPLY_SENDING = false;
  LOG_TASK_ACTION_BUSY = false;
  LOG_TASK_STATUS = "";
  LOG_VIEW_MODE = "timeline";
  LOG_RESULT = "";
  LOG_RESULT_LEN = 0;
  LOG_TIMELINE_PARSER = null;
  stopActivityTicker();
  updateLogActivityFooter(false, []);
  closeLogStream();
  clearLogWorkflowSteps();
  renderLogTaskDetail(null);
  setSessionPanelVisible(false);
  applyLogViewMode();
  if (CURRENT_VIEW === "tasks-list") renderTasks();
}

function isLogOpen() {
  return !!LOG_ID && CURRENT_VIEW === "tasks-list";
}

function isRawDrawerOpen() {
  return LOG_VIEW_MODE === "raw";
}

/** Top-most first. Register new modal masks here for Escape dismiss. */
const MODAL_DISMISS_LAYERS = [
  {
    id: "wfEditMask",
    isOpen: (el) => !!el?.classList.contains("show"),
    close: () => closeWorkflowEditor(),
  },
  {
    id: "agentEditMask",
    isOpen: (el) => !!el?.classList.contains("show"),
    close: () => closeAgentEditor(),
    closeDropdownsInRoot: true,
  },
  {
    id: "autopilotEditMask",
    isOpen: (el) => !!el?.classList.contains("show"),
    close: () => closeAutopilotEditor(),
  },
  {
    id: "skillMask",
    isOpen: (el) => !!el?.classList.contains("show"),
    close: () => closeSkillDetail(),
  },
  {
    id: "wsMask",
    isOpen: (el) => !!el?.classList.contains("show"),
    close: () => closeWorkspacePicker(),
  },
];

function handleEscapeDismiss() {
  for (const layer of MODAL_DISMISS_LAYERS) {
    const el = document.getElementById(layer.id);
    if (!el || !layer.isOpen(el)) continue;
    if (layer.closeDropdownsInRoot && el.querySelector(".setting-dropdown.open")) {
      closeAllSettingDropdowns();
      return true;
    }
    layer.close();
    return true;
  }
  if (isRawDrawerOpen()) {
    closeRawDrawer();
    return true;
  }
  if (isLogOpen()) {
    closeLog();
    return true;
  }
  if (document.querySelector(".setting-dropdown.open")) {
    closeAllSettingDropdowns();
    return true;
  }
  return false;
}

/** Escape for registered modals. Backdrop: mask onclick + onModalMaskClick(closeFn). */
function bindModalDismiss() {
  if (document.body.dataset.modalDismissBound) return;
  document.body.dataset.modalDismissBound = "1";
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (handleEscapeDismiss()) e.preventDefault();
  });
}

function onModalMaskClick(e, closeFn) {
  if (e.target !== e.currentTarget) return;
  closeFn();
}

function onTaskTypeChange() {
  const modeSel = document.getElementById("t-mode");
  const hidden = document.getElementById("t-type");
  const t = (modeSel && modeSel.value) || (hidden && hidden.value) || "skill";
  if (hidden) hidden.value = t;
  const wfWrap = document.getElementById("t-target-workflow-wrap");
  const skillWrap = document.getElementById("t-target-skill-wrap");
  if (wfWrap) wfWrap.style.display = t === "workflow" ? "" : "none";
  if (skillWrap) skillWrap.style.display = t === "skill" ? "" : "none";
  if (t === "workflow") fillWorkflowOptions();
  if (t === "skill") fillSkillOptions();
}

let TASK_SKILL_OPTS = [];

function getTaskSkillId() {
  const el = document.getElementById("t-skill");
  return ((el && el.dataset.value) || "default").trim() || "default";
}

async function fillSkillOptions(selectId) {
  const root = document.getElementById("t-skill");
  if (!root) return;
  const prev = getTaskSkillId();
  const cwd = getTaskDir() || undefined;
  let rows = [];
  try {
    const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    rows = await api(`/api/skills${q}`);
  } catch {
    rows = [];
  }
  const opts = [{ id: "default", displayName: "default", listLabel: "default（无技能包）" }].concat(
    (Array.isArray(rows) ? rows : []).map((s) => ({
      id: s.id,
      displayName: s.id,
      listLabel: s.description ? `${s.id} · ${s.description}` : `${s.id} (${s.source})`,
    })),
  );
  let current = prev;
  if (selectId) {
    if (!opts.some((o) => o.id === selectId)) {
      opts.push({ id: selectId, displayName: selectId, listLabel: selectId });
    }
    current = selectId;
  } else if (!opts.some((o) => o.id === current)) {
    current = "default";
  }
  TASK_SKILL_OPTS = opts;
  mountSettingDropdown(root, opts, current, () => {}, { listLabelKey: "listLabel" });
}

function setTaskDir(dirPath) {
  const val = (dirPath || "").trim();
  const hidden = document.getElementById("t-dir");
  if (hidden) hidden.value = val;
  syncWorkspaceLabel();
  const type = document.getElementById("t-type");
  if (!type || type.value === "skill") fillSkillOptions();
}

function shortProjectPath(p) {
  const s = String(p || "").replace(/\/$/, "");
  const parts = s.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 3) return s;
  return `…/${parts.slice(-2).join("/")}`;
}

function getTaskDir() {
  const hidden = document.getElementById("t-dir");
  return ((hidden && hidden.value) || "").trim();
}

function syncComposerState() {
  const card = document.getElementById("composerCard");
  const input = document.getElementById("t-prompt");
  const dir = getTaskDir();
  if (card) card.classList.toggle("has-workspace", !!dir);
  if (input && !(input.value || "").trim()) {
    input.placeholder = dir
      ? "描述你希望 Agent 做什么，例如：修复登录接口 500 错误…"
      : "选择一个工作区开始";
  }
}

function syncWorkspaceLabel() {
  const dir = getTaskDir();
  const label = document.getElementById("t-workspace-label");
  const btn = document.getElementById("t-workspace-btn");
  if (!label) return;
  if (!dir) {
    label.textContent = "选择工作区";
    label.removeAttribute("title");
    if (btn) btn.classList.remove("has-value");
  } else {
    label.textContent = shortProjectPath(dir);
    label.title = dir;
    if (btn) btn.classList.add("has-value");
  }
  syncComposerState();
}

function syncWsSelected() {
  const el = document.getElementById("ws-selected");
  const btn = document.getElementById("wsConfirmBtn");
  const path = FS_BROWSER_PATH || "";
  if (el) {
    el.textContent = path || "未选择";
    el.title = path;
  }
  if (btn) btn.disabled = !path;
}

function isWorkspacePickerOpen() {
  return document.getElementById("wsMask")?.classList.contains("show");
}

function openWorkspacePicker(e, purpose) {
  if (e && e.stopPropagation) e.stopPropagation();
  WS_PICK_PURPOSE = purpose || null;
  bindFsListNav();
  const mask = document.getElementById("wsMask");
  const btn = document.getElementById("t-workspace-btn");
  if (!mask) return;
  mask.classList.add("show");
  if (btn) btn.setAttribute("aria-expanded", "true");
  const preferBrowse = purpose && purpose.type === "workflow";
  setWsTab(preferBrowse ? "browse" : loadRecentDirs().length ? "recent" : "browse");
  const start = getTaskDir() || loadRecentDirs()[0] || "";
  loadFsBrowse(start);
  const filter = document.getElementById("ws-filter");
  if (filter) {
    filter.value = "";
    setTimeout(() => filter.focus(), 30);
  }
}

function closeWorkspacePicker() {
  const mask = document.getElementById("wsMask");
  const btn = document.getElementById("t-workspace-btn");
  if (mask) mask.classList.remove("show");
  if (btn) btn.setAttribute("aria-expanded", "false");
  WS_PICK_PURPOSE = null;
}

function onWsMaskClick(e) {
  onModalMaskClick(e, closeWorkspacePicker);
}

function setWsTab(tab) {
  WS_TAB = tab === "recent" ? "recent" : "browse";
  document.querySelectorAll(".ws-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === WS_TAB);
  });
  const toolbar = document.getElementById("wsBrowseToolbar");
  const filterWrap = document.getElementById("wsFilterWrap");
  if (toolbar) toolbar.style.display = WS_TAB === "browse" ? "" : "none";
  if (filterWrap) filterWrap.style.display = WS_TAB === "browse" ? "" : "none";
  if (WS_TAB === "recent") renderRecentList();
  else renderFsList(FS_ENTRIES, false);
}

function autoResizeComposer() {
  const el = document.getElementById("t-prompt");
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
}

async function loadFsBrowse(browsePath) {
  const list = document.getElementById("t-fs-list");
  const pathEl = document.getElementById("t-fs-path");
  const upBtn = document.getElementById("wsUpBtn");
  if (list && WS_TAB === "browse") list.innerHTML = '<div class="ws-empty">加载中…</div>';
  try {
    const qs = browsePath ? `?path=${encodeURIComponent(browsePath)}` : "";
    const res = await fetch(`/api/fs/browse${qs}`);
    let d = {};
    try {
      d = await res.json();
    } catch {
      d = {};
    }
    if (!res.ok || !d.ok) {
      const msg = d.error || d.message || res.statusText || "加载失败";
      if (list) list.innerHTML = `<div class="ws-empty">${esc(msg)}</div>`;
      return;
    }
    FS_BROWSER_PATH = d.path || "";
    FS_BROWSER_PARENT = d.parent || "";
    FS_ENTRIES = d.entries || [];
    if (pathEl) {
      pathEl.textContent = FS_BROWSER_PATH;
      pathEl.title = FS_BROWSER_PATH;
    }
    if (upBtn) {
      upBtn.disabled = !FS_BROWSER_PARENT;
    }
    syncWsSelected();
    if (WS_TAB === "browse") renderFsList(FS_ENTRIES, !!d.truncated);
  } catch (err) {
    if (list) {
      list.innerHTML = `<div class="ws-empty">${esc(err.message || "加载失败")}<br><span style="font-size:11px;color:#9ca3af">请确认 oh web 已重启以加载 /api/fs/browse</span></div>`;
    }
  }
}

function folderSvg() {
  return `<svg class="ws-item-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 7.5A1.5 1.5 0 014.5 6H9l2 2h8.5A1.5 1.5 0 0121 9.5v8a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5v-10z"
      stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function onWsFilterInput() {
  if (WS_TAB === "browse") renderFsList(FS_ENTRIES, false);
}

function renderFsList(entries, truncated) {
  const list = document.getElementById("t-fs-list");
  if (!list || WS_TAB !== "browse") return;
  const kw = ((document.getElementById("ws-filter") || {}).value || "").trim().toLowerCase();
  const filtered = kw
    ? entries.filter((item) => String(item.name || "").toLowerCase().includes(kw))
    : entries;
  if (!filtered.length) {
    list.innerHTML = `<div class="ws-empty">${kw ? "无匹配目录" : "此目录下没有子文件夹"}</div>`;
    return;
  }
  list.innerHTML =
    filtered
      .map(
        (item) =>
          `<button type="button" class="ws-item" data-path="${esc(item.path)}">` +
          `${folderSvg()}<span class="ws-item-name">${esc(item.name)}</span>` +
          `<span class="ws-item-chev">›</span></button>`,
      )
      .join("") +
    (truncated && !kw ? '<div class="ws-empty">仅显示前 300 个文件夹</div>' : "");
}

function renderRecentList() {
  const list = document.getElementById("t-fs-list");
  if (!list) return;
  const recent = loadRecentDirs();
  if (!recent.length) {
    list.innerHTML = '<div class="ws-empty">暂无最近使用的工作区</div>';
    syncWsSelected();
    return;
  }
  list.innerHTML = recent
    .map(
      (p) =>
        `<button type="button" class="ws-item" data-path="${esc(p)}" data-recent="1">` +
        `${folderSvg()}<span class="ws-item-name" title="${esc(p)}">${esc(shortProjectPath(p))}</span>` +
        `<span class="ws-item-chev">›</span></button>`,
    )
    .join("");
}

function bindFsListNav() {
  const list = document.getElementById("t-fs-list");
  if (!list || list.dataset.bound) return;
  list.dataset.bound = "1";
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".ws-item");
    if (!btn) return;
    const p = btn.getAttribute("data-path") || "";
    if (!p) return;
    if (WS_TAB === "recent") {
      FS_BROWSER_PATH = p;
      syncWsSelected();
      void confirmWorkspacePath(p);
      return;
    }
    loadFsBrowse(p);
  });
}

function fsBrowseParent() {
  if (FS_BROWSER_PARENT) loadFsBrowse(FS_BROWSER_PARENT);
}

function fsBrowseHome() {
  loadFsBrowse("");
}

function fsBrowseUsersRoot() {
  const home = FS_BROWSER_PATH || "";
  // Prefer /Users on macOS-style paths; otherwise parent of home after first load.
  if (home.startsWith("/Users/")) loadFsBrowse("/Users");
  else if (FS_BROWSER_PARENT) loadFsBrowse(FS_BROWSER_PARENT);
  else loadFsBrowse("");
}

async function fsMkdirPrompt() {
  if (!FS_BROWSER_PATH) return toast("请先进入一个目录");
  const name = (window.prompt("新建文件夹名称") || "").trim();
  if (!name) return;
  if (/[/\\]/.test(name) || name === "." || name === "..") return toast("名称无效");
  try {
    const d = await api("/api/fs/mkdir", {
      method: "POST",
      body: JSON.stringify({ path: FS_BROWSER_PATH, name }),
    });
    if (!d.ok) throw new Error(d.error || "创建失败");
    await loadFsBrowse(FS_BROWSER_PATH);
    toast("已创建文件夹");
  } catch (e) {
    toast(e.message || String(e));
  }
}

function explainWorkflowStartError(err, wfId) {
  const msg = String((err && err.message) || err || "").trim();
  const low = msg.toLowerCase();
  if (/not_found|not found|workflow not found/i.test(msg)) {
    return `流程「${wfId}」不存在或未加载。请到「设置 → 任务默认 → 缺陷 AI 修复流程」检查，或先同步系统模板。`;
  }
  if (/skill|技能/.test(low) || /unknown skill|skill not/.test(low)) {
    return `流程依赖的技能缺失或无法解析：${msg || "请到「技能」页同步内置技能"}`;
  }
  if (/project|workdir|工作区|directory|enoent|not a directory/i.test(msg)) {
    return `工作区无效：${msg || "请重新选择本地目录"}`;
  }
  if (/permission|eacces|denied/i.test(msg)) {
    return `没有权限访问工作区或启动 Agent：${msg}`;
  }
  return `启动流程失败：${msg || "未知错误"}`;
}

async function startWorkflowRun(workflowId, opts = {}) {
  const projectDir = String(opts.projectDir || "").trim();
  if (!projectDir) throw new Error("请选择工作区");
  const agentProfileId = String(opts.agentProfileId || getSelectedAgentProfileId() || "").trim();
  const body = {
    projectDir,
    title: opts.title,
    prompt: opts.prompt,
    ...(agentProfileId ? { agentProfileId } : {}),
    ...(opts.issueCode ? { issueCode: opts.issueCode } : {}),
  };
  const run = await api(`/api/workflows/${encodeURIComponent(workflowId)}/run`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  pushRecentDir(projectDir);
  return run;
}

async function confirmWorkspacePath(path) {
  const dir = String(path || "").trim();
  if (!dir) return;
  const purpose = WS_PICK_PURPOSE;
  setTaskDir(dir);
  clearTaskDirErr();
  // Clear purpose before close so closeWorkspacePicker doesn't wipe mid-flight incorrectly
  WS_PICK_PURPOSE = null;
  const mask = document.getElementById("wsMask");
  const btn = document.getElementById("t-workspace-btn");
  if (mask) mask.classList.remove("show");
  if (btn) btn.setAttribute("aria-expanded", "false");

  if (purpose && purpose.type === "workflow" && purpose.workflowId) {
    try {
      const run = await startWorkflowRun(purpose.workflowId, {
        projectDir: dir,
        title: purpose.title,
        prompt: purpose.prompt,
        issueCode: purpose.issueCode,
      });
      toast("流程已启动，正在打开任务…");
      switchView("tasks-list");
      if (run.parentTaskId) showLog(run.parentTaskId);
    } catch (e) {
      toast(explainWorkflowStartError(e, purpose.workflowId));
    }
  }
}

function fsSelectCurrent() {
  if (!FS_BROWSER_PATH) return;
  void confirmWorkspacePath(FS_BROWSER_PATH);
}

function loadRecentDirs() {
  try {
    const raw = localStorage.getItem(RECENT_DIR_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === "string" && x.trim()) : [];
  } catch {
    return [];
  }
}

function pushRecentDir(dir) {
  const d = (dir || "").trim();
  if (!d) return;
  let list = loadRecentDirs().filter((x) => x !== d);
  list.unshift(d);
  list = list.slice(0, RECENT_DIR_MAX);
  try {
    localStorage.setItem(RECENT_DIR_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function clearTaskDirErr() {
  const err = document.getElementById("t-dir-err");
  const btn = document.getElementById("t-workspace-btn");
  const card = document.getElementById("composerCard");
  if (btn) btn.classList.remove("is-invalid");
  if (card) card.classList.remove("is-invalid");
  if (err) {
    err.textContent = "";
    err.hidden = true;
  }
}

function showTaskDirErr(msg) {
  const err = document.getElementById("t-dir-err");
  const btn = document.getElementById("t-workspace-btn");
  const card = document.getElementById("composerCard");
  if (btn) btn.classList.add("is-invalid");
  if (card) card.classList.add("is-invalid");
  if (err) {
    err.textContent = msg;
    err.hidden = false;
  }
  openWorkspacePicker();
}

function onTaskPromptInput() {
  const el = document.getElementById("t-prompt");
  const hint = document.getElementById("t-prompt-hint");
  if (!el || !hint) return;
  let v = el.value || "";
  if (v.length > PROMPT_MAX) {
    el.value = v.slice(0, PROMPT_MAX);
    v = el.value;
  }
  const n = v.length;
  if (n <= 0) {
    hint.classList.remove("warn");
    hint.textContent = "";
    return;
  }
  hint.textContent = `${n}/${PROMPT_MAX}`;
  hint.classList.toggle("warn", n >= PROMPT_MAX);
  autoResizeComposer();
}

function bindTaskNewFormOnce() {
  const view = document.getElementById("view-tasks-new");
  const prompt = document.getElementById("t-prompt");
  bindFsListNav();
  if (prompt && !prompt.dataset.bound) {
    prompt.dataset.bound = "1";
    prompt.addEventListener("input", autoResizeComposer);
  }
  if (view && !view.dataset.bound) {
    view.dataset.bound = "1";
    view.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        createTask();
      }
    });
  }
}

async function initTaskNewPage() {
  bindTaskNewFormOnce();
  onTaskTypeChange();
  syncWorkspaceLabel();
  fillSkillOptions();
  try {
    const s = await api("/api/settings");
    await refreshAgentProviderCache();
    await refreshTaskAgentPickers(s);
  } catch {
    /* ignore */
  }
  autoResizeComposer();
  const prompt = document.getElementById("t-prompt");
  if (prompt) prompt.focus();
}

async function fillWorkflowOptions() {
  try {
    WORKFLOW_LIST = await api("/api/workflows");
  } catch {
    WORKFLOW_LIST = [];
  }
  const sel = document.getElementById("t-workflow");
  if (!sel) return;
  if (!WORKFLOW_LIST.length) {
    sel.innerHTML = '<option value="">(暂无流程模板)</option>';
    return;
  }
  sel.innerHTML = WORKFLOW_LIST.map(
    (w) => `<option value="${esc(w.id)}">${esc(w.name)} · ${esc(w.mode)} · ${(w.nodes || []).length}步</option>`,
  ).join("");
}

async function createTask() {
  if (creating) return;
  const type = document.getElementById("t-type").value;
  const prompt = (document.getElementById("t-prompt").value || "").trim().slice(0, PROMPT_MAX);
  const projectDir = getTaskDir();
  let title = (document.getElementById("t-title").value || "").trim().slice(0, TITLE_MAX);
  if (!title && prompt) title = prompt.split("\n")[0].trim().slice(0, TITLE_MAX);

  clearTaskDirErr();
  if (!projectDir) {
    showTaskDirErr("请先选择工作区（项目目录）");
    return;
  }
  if (type === "skill" && !prompt) {
    toast("请先描述任务内容");
    return;
  }
  if (prompt.length > PROMPT_MAX) return toast(`描述最多 ${PROMPT_MAX} 字`);

  creating = true;
  const btn = document.getElementById("btnCreateTask");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-busy");
  }
  try {
    if (type === "workflow") {
      const workflowId = document.getElementById("t-workflow").value;
      if (!workflowId) throw new Error("请选择流程");
      const issueCode = (document.getElementById("t-issue-code")?.value || "").trim();
      const agentProfileId = getSelectedAgentProfileId();
      const run = await api(`/api/workflows/${encodeURIComponent(workflowId)}/run`, {
        method: "POST",
        body: JSON.stringify({
          title,
          prompt,
          projectDir,
          ...(agentProfileId ? { agentProfileId } : {}),
          ...(issueCode ? { issueCode } : {}),
        }),
      });
      pushRecentDir(projectDir);
      const issueEl = document.getElementById("t-issue-code");
      if (issueEl) issueEl.value = "";
      toast("流程已启动，正在打开任务…");
      switchView("tasks-list");
      if (run.parentTaskId) showLog(run.parentTaskId);
    } else {
      const skill = getTaskSkillId();
      const issueCode = (document.getElementById("t-issue-code")?.value || "").trim();
      const agentProfileId = getSelectedAgentProfileId();
      const task = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title || "Untitled",
          prompt,
          projectDir,
          skill,
          model: (document.getElementById("t-model")?.dataset.value || "").trim(),
          ...(agentProfileId ? { agentProfileId } : {}),
          ...(issueCode ? { issueCode } : {}),
        }),
      });
      pushRecentDir(projectDir);
      toast("任务已创建");
      const issueEl = document.getElementById("t-issue-code");
      if (issueEl) issueEl.value = "";
      switchView("tasks-list");
      showLog(task.id);
    }
  } catch (e) {
    toast(e.message || String(e));
  } finally {
    creating = false;
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("is-busy");
    }
  }
}

function workflowModeLabel(w) {
  return w.mode === "independent" ? "独立执行" : "共享上下文";
}

function matchWorkflowSearch(w, kw) {
  if (!kw) return true;
  const nodes = (w.nodes || []).map((n) => (n.skill || "") + (n.title || "")).join(" ");
  const hay = [w.name, w.description, w.id, nodes].join(" ").toLowerCase();
  return hay.includes(kw);
}

function renderWorkflowItem(w) {
  const id = esc(w.id || "");
  const name = esc(w.name || "-");
  const desc = esc(w.description || "") || `${(w.nodes || []).length} 个节点 · ${esc(workflowModeLabel(w))}`;
  const meta = `${(w.nodes || []).length} 步 · ${esc(workflowModeLabel(w))}`;
  const letter = esc((w.name || "?").charAt(0).toUpperCase());
  const isUser = w.source !== "system";
  const chain = (w.nodes || [])
    .map((n) => esc(n.title || n.skill || "?"))
    .join(" → ");
  const acts = isUser
    ? `<button class="btn-refresh" type="button" onclick="openWorkflowEditor('${id}')">编辑</button>` +
      `<button class="btn-install" type="button" onclick="runWorkflow('${id}')">运行</button>` +
      `<button class="btn-stop" type="button" onclick="deleteWorkflow('${id}')">删除</button>`
    : `<button class="btn-refresh" type="button" onclick="openWorkflowEditor('${id}', { copy: true })">复制</button>` +
      `<button class="btn-install" type="button" onclick="runWorkflow('${id}')">运行</button>`;
  return `<div class="skill-item wf-item">
    <div class="sk-icon" style="background:${iconColor(w.id || w.name)}">${letter}</div>
    <div class="sk-info">
      <div class="n">${name}</div>
      <div class="d">${desc}</div>
      <div class="sk-ver">${meta}${chain ? ` · ${chain}` : ""}</div>
    </div>
    <div class="sk-right">
      <div class="sk-act" style="display:flex;gap:6px;flex-wrap:wrap">${acts}</div>
    </div>
  </div>`;
}

function renderWorkflowSection(title, items) {
  if (!items.length) return "";
  return `<div class="wf-section"><h3 class="wf-sec-title">${title}</h3><div class="skill-grid">${items.map(renderWorkflowItem).join("")}</div></div>`;
}

function renderWorkflows() {
  const box = document.getElementById("wf-list");
  if (!box) return;
  const kw = (document.getElementById("wf-q") || {}).value.trim().toLowerCase();
  let items = WORKFLOW_LIST.filter((w) => matchWorkflowSearch(w, kw));
  const systemItems = items.filter((w) => w.source === "system");
  const userItems = items.filter((w) => w.source !== "system");
  let html = "";
  if (WF_FILTER === "all" || WF_FILTER === "system") html += renderWorkflowSection("系统", systemItems);
  if (WF_FILTER === "all" || WF_FILTER === "user") html += renderWorkflowSection("个人", userItems);
  if (!html) {
    box.innerHTML = `<div class="wf-empty">${kw ? "无匹配的流程模板" : "暂无流程模板"}</div>`;
    return;
  }
  box.innerHTML = html;
}

function runStatusLabel(st) {
  return (
    {
      pending: "待执行",
      running: "运行中",
      awaiting: "待确认",
      done: "已完成",
      failed: "失败",
      stopped: "已停止",
    }[st] ||
    st ||
    "-"
  );
}

function renderWorkflowRuns() {
  const box = document.getElementById("wf-runs");
  if (!box) return;
  const rows = (WF_RUNS || []).slice(0, 20);
  if (!rows.length) {
    box.innerHTML = '<div class="wf-empty">暂无运行记录</div>';
    return;
  }
  box.innerHTML = rows
    .map((r) => {
      const title = esc(r.workflowName || r.workflowId || r.id);
      const st = esc(runStatusLabel(r.status));
      const issue = r.issueCode ? `<span class="bug-code">${esc(r.issueCode)}</span> · ` : "";
      const when = esc(fmtTime(r.updatedAt || r.createdAt));
      const steps = (r.nodes || [])
        .map((n) => {
          const cls = esc(n.status || "pending");
          const label = esc(n.title || n.skill || "?");
          return `<span class="wf-run-step ${cls}">${label}</span>`;
        })
        .join("");
      const taskId = esc(r.parentTaskId || "");
      const status = esc(r.status || "");
      const openBtn = taskId
        ? `<button type="button" class="btn-outline" onclick="openWorkflowRunTask('${taskId}', '${status}')">查看任务</button>`
        : `<span class="wf-run-muted">无关联任务</span>`;
      return `<div class="wf-run-item">
        <div class="wr-main">
          <div class="wr-title">${title} · ${st}</div>
          <div class="wr-sub">${issue}${when}</div>
          <div class="wf-run-steps">${steps}</div>
        </div>
        ${openBtn}
      </div>`;
    })
    .join("");
}

async function loadWorkflowRuns() {
  try {
    const rows = await api("/api/workflow-runs");
    WF_RUNS = Array.isArray(rows) ? rows : [];
    renderWorkflowRuns();
  } catch {
    WF_RUNS = [];
    renderWorkflowRuns();
  }
}

async function loadWorkflows() {
  try {
    WORKFLOW_LIST = await api("/api/workflows");
    renderWorkflows();
    await loadWorkflowRuns();
  } catch (e) {
    toast(`加载流程失败: ${e.message || e}`);
  }
}

function setWorkflowFilter(v) {
  WF_FILTER = v || "all";
  const sel = document.getElementById("wf-filter");
  if (sel && sel.value !== v) sel.value = v;
  renderWorkflows();
}

async function runWorkflow(id) {
  if (!id) return;
  const existing = (document.getElementById("t-dir")?.value || "").trim() || loadRecentDirs()[0] || "";
  if (existing) {
    // Still confirm via picker so user can change; preselect recent tab
    openWorkspacePicker(null, { type: "workflow", workflowId: id });
    return;
  }
  openWorkspacePicker(null, { type: "workflow", workflowId: id });
  toast("请选择工作区后启动流程");
}

async function deleteWorkflow(id) {
  if (!id || !confirm(`确定删除流程「${id}」？`)) return;
  try {
    await api(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("已删除流程");
    await loadWorkflows();
  } catch (e) {
    toast(`删除失败: ${e.message || e}`);
  }
}

function slugifyWorkflowId(name) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `wf-${Date.now().toString(36)}`;
}

async function ensureWfSkillOpts() {
  if (WF_SKILL_OPTS.length) return WF_SKILL_OPTS;
  try {
    const rows = await api("/api/skills");
    WF_SKILL_OPTS = Array.isArray(rows) ? rows : [];
  } catch {
    WF_SKILL_OPTS = [];
  }
  return WF_SKILL_OPTS;
}

function skillOptionsHtml(selected) {
  const sel = selected || "default";
  const opts = WF_SKILL_OPTS.length
    ? WF_SKILL_OPTS
    : [{ id: "default", name: "default" }, { id: "triage", name: "triage" }, { id: "fix", name: "fix" }, { id: "test", name: "test" }];
  const ids = new Set(opts.map((o) => o.id));
  if (sel && !ids.has(sel)) opts.unshift({ id: sel, name: sel });
  return opts
    .map((o) => {
      const id = o.id || o.name;
      return `<option value="${esc(id)}"${id === sel ? " selected" : ""}>${esc(o.name || id)}</option>`;
    })
    .join("");
}

function renderWfEditorNodes() {
  const box = document.getElementById("wf-ed-nodes");
  if (!box || !WF_EDIT) return;
  const nodes = WF_EDIT.nodes || [];
  if (!nodes.length) {
    box.innerHTML = '<div class="wf-empty">请添加至少一个步骤</div>';
    return;
  }
  box.innerHTML = nodes
    .map((n, i) => {
      const gateChecked = n.requireGate ? " checked" : "";
      const agentOpts = agentProfileDropdownOptions(AGENT_PROFILES, true)
        .map(
          (o) =>
            `<option value="${esc(o.id)}"${o.id === (n.agentProfileId || "") ? " selected" : ""}>${esc(o.displayName)}</option>`,
        )
        .join("");
      return `<div class="wf-ed-node" data-idx="${i}">
        <div class="wf-ed-node-top">
          <input type="text" data-k="title" value="${esc(n.title || "")}" placeholder="步骤标题">
          <select data-k="skill">${skillOptionsHtml(n.skill || "default")}</select>
          <select data-k="agentProfileId" title="本步 Agent">${agentOpts}</select>
          <button type="button" class="btn-stop" onclick="wfEditorRemoveNode(${i})">删除</button>
        </div>
        <textarea data-k="prompt" placeholder="本步指令（可选）">${esc(n.prompt || "")}</textarea>
        <div class="wf-ed-node-foot">
          <label><input type="checkbox" data-k="requireGate"${gateChecked}> 强制闸门</label>
          <span style="font-size:12px;color:#9aa0a6">步骤 ${i + 1}</span>
        </div>
      </div>`;
    })
    .join("");
}

function readWfEditorNodesFromDom() {
  const box = document.getElementById("wf-ed-nodes");
  if (!box || !WF_EDIT) return;
  const nodes = [];
  box.querySelectorAll(".wf-ed-node").forEach((el, i) => {
    const title = (el.querySelector('[data-k="title"]')?.value || "").trim();
    const skill = (el.querySelector('[data-k="skill"]')?.value || "").trim();
    const prompt = (el.querySelector('[data-k="prompt"]')?.value || "").trim();
    const requireGate = !!el.querySelector('[data-k="requireGate"]')?.checked;
    const agentProfileId = (el.querySelector('[data-k="agentProfileId"]')?.value || "").trim();
    nodes.push({
      id: (WF_EDIT.nodes[i] && WF_EDIT.nodes[i].id) || `n${i + 1}`,
      title: title || skill || `步骤 ${i + 1}`,
      skill: skill || "default",
      prompt,
      ...(agentProfileId ? { agentProfileId } : {}),
      requireGate,
      onFailure: "stop",
    });
  });
  WF_EDIT.nodes = nodes;
}

function wfEditorAddNode() {
  readWfEditorNodesFromDom();
  if (!WF_EDIT) return;
  const i = WF_EDIT.nodes.length + 1;
  WF_EDIT.nodes.push({
    id: `n${i}`,
    title: `步骤 ${i}`,
    skill: "fix",
    prompt: "",
    requireGate: false,
    onFailure: "stop",
  });
  renderWfEditorNodes();
}

function wfEditorRemoveNode(idx) {
  readWfEditorNodesFromDom();
  if (!WF_EDIT) return;
  WF_EDIT.nodes.splice(idx, 1);
  renderWfEditorNodes();
}

function onWfEditMaskClick(e) {
  onModalMaskClick(e, closeWorkflowEditor);
}

function closeWorkflowEditor() {
  const mask = document.getElementById("wfEditMask");
  if (mask) mask.classList.remove("show");
  WF_EDIT = null;
}

async function openWorkflowEditor(id, opts = {}) {
  await Promise.all([ensureWfSkillOpts(), loadAgentProfiles()]);
  let settings = {};
  try {
    settings = await api("/api/settings");
  } catch {
    /* ignore */
  }
  const defaultMode = settings.defaultWorkflowMode || "shared";
  const copy = !!(opts && opts.copy);
  const existing = id ? WORKFLOW_LIST.find((w) => w.id === id) : null;

  const cloneNodes = (nodes) =>
    (nodes || []).map((n, i) => ({
      id: n.id || `n${i + 1}`,
      title: n.title || n.skill || `步骤 ${i + 1}`,
      skill: n.skill || "default",
      prompt: n.prompt || "",
      agentProfileId: n.agentProfileId || n.agent_profile_id || "",
      requireGate: !!n.requireGate,
      onFailure: n.onFailure || "stop",
    }));

  if (existing && (copy || existing.source === "system")) {
    WF_EDIT = {
      isNew: true,
      id: `${String(existing.id || "flow").replace(/^sys-/, "")}-copy`,
      name: `${existing.name || existing.id} 副本`,
      description: existing.description || "",
      mode: existing.mode || defaultMode,
      nodes: cloneNodes(existing.nodes),
      readOnlyId: false,
    };
  } else if (existing) {
    WF_EDIT = {
      isNew: false,
      id: existing.id,
      name: existing.name || "",
      description: existing.description || "",
      mode: existing.mode || defaultMode,
      nodes: cloneNodes(existing.nodes),
      readOnlyId: true,
    };
  } else {
    WF_EDIT = {
      isNew: true,
      id: "",
      name: "",
      description: "",
      mode: defaultMode,
      nodes: [
        { id: "n1", title: "Triage", skill: "triage", prompt: "", requireGate: true, onFailure: "stop" },
        { id: "n2", title: "Fix", skill: "fix", prompt: "", requireGate: true, onFailure: "stop" },
        { id: "n3", title: "Test", skill: "test", prompt: "", requireGate: false, onFailure: "stop" },
      ],
      readOnlyId: false,
    };
  }

  document.getElementById("wfEditTitle").textContent = WF_EDIT.isNew ? "新建流程" : "编辑流程";
  document.getElementById("wf-ed-name").value = WF_EDIT.name;
  const idEl = document.getElementById("wf-ed-id");
  idEl.value = WF_EDIT.id;
  idEl.disabled = !!WF_EDIT.readOnlyId;
  document.getElementById("wf-ed-desc").value = WF_EDIT.description || "";
  document.getElementById("wf-ed-mode").value = WF_EDIT.mode === "independent" ? "independent" : "shared";
  renderWfEditorNodes();
  document.getElementById("wfEditMask").classList.add("show");
}

async function saveWorkflowEditor() {
  if (!WF_EDIT) return;
  readWfEditorNodesFromDom();
  const name = (document.getElementById("wf-ed-name").value || "").trim();
  let id = (document.getElementById("wf-ed-id").value || "").trim();
  const description = (document.getElementById("wf-ed-desc").value || "").trim();
  const mode = document.getElementById("wf-ed-mode").value === "independent" ? "independent" : "shared";
  if (!name) return toast("请填写流程名称");
  if (!id) id = slugifyWorkflowId(name);
  if (!WF_EDIT.nodes.length) return toast("至少添加一个步骤");
  for (const n of WF_EDIT.nodes) {
    if (!n.skill) return toast("每个步骤都需要选择技能");
  }

  const body = {
    id,
    name,
    description,
    mode,
    nodes: WF_EDIT.nodes.map((n, i) => ({
      id: n.id || `n${i + 1}`,
      title: n.title,
      skill: n.skill,
      prompt: n.prompt || "",
      ...(n.agentProfileId ? { agentProfileId: n.agentProfileId } : {}),
      requireGate: !!n.requireGate,
      onFailure: "stop",
    })),
  };

  try {
    if (WF_EDIT.isNew) {
      await api("/api/workflows", { method: "POST", body: JSON.stringify(body) });
    } else {
      await api(`/api/workflows/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    }
    toast("流程已保存");
    closeWorkflowEditor();
    await loadWorkflows();
  } catch (e) {
    toast(`保存失败: ${e.message || e}`);
  }
}

function skillSourceLabel(source) {
  return SKILL_SOURCE_LABEL[source] || source || "未知";
}

function skillFilterBucket(s) {
  if (s.managed || s.source === "bundled") return "bundled";
  if (s.removable || s.source === "user") return "user";
  if (s.source === "custom") return "custom";
  if (String(s.source || "").startsWith("project")) return "project";
  return "other";
}

function matchSkillSearch(s, kw) {
  if (!kw) return true;
  const hay = [s.id, s.name, s.description, s.source, s.version].join(" ").toLowerCase();
  return hay.includes(kw);
}

function renderSkillItem(s) {
  const id = esc(s.id || "");
  const name = esc(s.name || s.id || "-");
  const desc = esc(s.description || "（无描述）");
  const ver = s.version ? `<div class="sk-ver">v${esc(s.version)}</div>` : "";
  const letter = esc((s.name || s.id || "?").charAt(0).toUpperCase());
  const uninstallBtn = s.removable
    ? `<button class="btn-stop" type="button" onclick="uninstallSkill('${id}')">卸载</button>`
    : "";
  return `<div class="skill-item wf-item">
    <div class="sk-icon" style="background:${iconColor(s.id || s.name)}">${letter}</div>
    <div class="sk-info">
      <div class="n">${name}</div>
      <div class="d">${desc}</div>
      ${ver}
    </div>
    <div class="sk-right">
      <div class="sk-act" style="display:flex">
        <button class="btn-refresh" type="button" onclick="showSkillDetail('${id}')">查看</button>
        <button class="btn-install" type="button" onclick="useSkillInNewTask('${id}')">使用</button>
        ${uninstallBtn}
      </div>
    </div>
  </div>`;
}

function renderSkillSection(title, items) {
  if (!items.length) return "";
  return `<div class="wf-section"><h3 class="wf-sec-title">${title}</h3><div class="skill-grid">${items.map(renderSkillItem).join("")}</div></div>`;
}

function renderSkills() {
  const box = document.getElementById("sk-list");
  if (!box) return;
  const kw = ((document.getElementById("sk-q") || {}).value || "").trim().toLowerCase();
  let items = SKILL_LIST.filter((s) => matchSkillSearch(s, kw));
  if (SK_FILTER !== "all") {
    items = items.filter((s) => skillFilterBucket(s) === SK_FILTER);
  }
  const groups = [
    ["内置（随 CLI 安装 / 更新）", items.filter((s) => skillFilterBucket(s) === "bundled")],
    ["用户自建（可卸载）", items.filter((s) => skillFilterBucket(s) === "user")],
    ["项目", items.filter((s) => skillFilterBucket(s) === "project")],
    ["自定义", items.filter((s) => skillFilterBucket(s) === "custom")],
    ["其他", items.filter((s) => skillFilterBucket(s) === "other")],
  ];
  let html = "";
  for (const [title, rows] of groups) html += renderSkillSection(title, rows);
  if (!html) {
    box.innerHTML = `<div class="wf-empty">${kw ? "无匹配的技能" : "暂无技能。内置技能请点「同步内置」；自建请放到 ~/.agent-desk/skills/&lt;name&gt;/SKILL.md"}</div>`;
    return;
  }
  box.innerHTML = html;
}

async function loadSkills() {
  try {
    const cwd = getTaskDir() || undefined;
    const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    SKILL_LIST = await api(`/api/skills${q}`);
    if (!Array.isArray(SKILL_LIST)) SKILL_LIST = [];
    renderSkills();
  } catch (e) {
    toast(`加载技能失败: ${e.message || e}`);
  }
}

async function syncSkills(force) {
  try {
    const result = await api("/api/skills/sync", {
      method: "POST",
      body: JSON.stringify({ force: !!force }),
    });
    const sync = result.sync || result;
    const seed = result.seed || {};
    const bits = [];
    if (sync.installed?.length) bits.push(`内置新装 ${sync.installed.length}`);
    if (sync.updated?.length) bits.push(`内置更新 ${sync.updated.length}`);
    if (seed.seeded?.length) bits.push(`种子 ${seed.seeded.length}`);
    if (seed.demoted?.length) bits.push(`转为自建 ${seed.demoted.length}`);
    if (sync.errors?.length || seed.errors?.length) {
      bits.push(`失败 ${(sync.errors?.length || 0) + (seed.errors?.length || 0)}`);
    }
    toast(bits.length ? `技能同步完成（${bits.join(" · ")}）` : "技能已是最新");
    await loadSkills();
  } catch (e) {
    toast(`同步失败: ${e.message || e}`);
  }
}

async function uninstallSkill(id) {
  if (!confirm(`确定卸载用户技能「${id}」？内置技能不能卸载。`)) return;
  try {
    await api(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast(`已卸载：${id}`);
    await loadSkills();
  } catch (e) {
    toast(`卸载失败: ${e.message || e}`);
  }
}

function setSkillFilter(v) {
  SK_FILTER = v || "all";
  const sel = document.getElementById("sk-filter");
  if (sel && sel.value !== v) sel.value = v;
  renderSkills();
}

function closeSkillDetail() {
  const mask = document.getElementById("skillMask");
  if (mask) mask.classList.remove("show");
}

function onSkillMaskClick(e) {
  onModalMaskClick(e, closeSkillDetail);
}

async function showSkillDetail(id) {
  const mask = document.getElementById("skillMask");
  const titleEl = document.getElementById("skillTitle");
  const metaEl = document.getElementById("skillMeta");
  const bodyEl = document.getElementById("skillBody");
  if (!mask || !bodyEl) return;
  titleEl.textContent = id;
  metaEl.textContent = "加载中…";
  bodyEl.textContent = "";
  mask.classList.add("show");
  try {
    const cwd = getTaskDir() || undefined;
    const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const skill = await api(`/api/skills/${encodeURIComponent(id)}${q}`);
    titleEl.textContent = skill.name || skill.id || id;
    const bits = [
      skill.id ? `id: ${skill.id}` : "",
      skill.managed || skill.source === "bundled" ? "内置" : skillSourceLabel(skill.source),
      skill.version ? `v${skill.version}` : "",
      skill.removable ? "可卸载" : "",
    ].filter(Boolean);
    metaEl.textContent = bits.join(" · ");
    metaEl.title = skill.dir || skill.path || "";
    bodyEl.textContent = skill.instructions || "(空)";
  } catch (e) {
    metaEl.textContent = "";
    bodyEl.textContent = `加载失败: ${e.message || e}`;
  }
}

function useSkillInNewTask(id) {
  switchView("tasks-new");
  const mode = document.getElementById("t-mode");
  if (mode) {
    mode.value = "skill";
    onTaskTypeChange();
  }
  fillSkillOptions(id).then(() => {
    toast(`已选择技能：${id}`);
  });
}

async function saveSettingsPatch(patch) {
  return api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(patch || {}),
  });
}

const SETTINGS_SECRET_MASK = "********";

function secretEyeIcon(visible) {
  const common = 'viewBox="0 0 24 24" fill="none" aria-hidden="true"';
  if (visible) {
    return (
      `<svg ${common}>` +
      `<path d="M4 4l16 16M9.9 9.9A3 3 0 0114.1 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>` +
      `<path d="M10.5 5.2A10.5 10.5 0 0121.5 12a10.6 10.6 0 01-3.2 4.3M6.7 6.7A10.5 10.5 0 002.5 12a10.5 10.5 0 0012.8 6.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`
    );
  }
  return (
    `<svg ${common}>` +
    `<path d="M2.5 12S6.5 6.5 12 6.5 21.5 12 21.5 12 17.5 17.5 12 17.5 2.5 12 2.5 12z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>` +
    `<circle cx="12" cy="12" r="2.8" stroke="currentColor" stroke-width="1.7"/>` +
    `</svg>`
  );
}

function settingsGet(state, key) {
  if (!key.includes(".")) return state[key];
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), state);
}

function settingsPatchForKey(key, value) {
  if (!key.includes(".")) return { [key]: value };
  const parts = key.split(".");
  const root = {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}

function setNestedSettingState(state, key, value) {
  const parts = key.split(".");
  if (parts.length !== 2) return;
  state[parts[0]] = { ...(state[parts[0]] || {}), [parts[1]]: value };
}

function setSubconfigExpanded(card, expanded) {
  if (!card) return;
  card.classList.toggle("is-expanded", expanded);
  const head = card.querySelector(".setting-subconfig-head");
  if (head) head.setAttribute("aria-expanded", expanded ? "true" : "false");
}

const settingRowStatusTimers = new WeakMap();

function ensureSettingRowStatus(row) {
  let el = row.querySelector(".setting-save-status");
  if (!el) {
    el = document.createElement("span");
    el.className = "setting-save-status";
    el.setAttribute("aria-live", "polite");
    if (row.classList.contains("is-stack")) {
      row.appendChild(el);
    } else {
      const control = row.querySelector(
        ".toggle, .setting-dropdown, .setting-select, .setting-secret-wrap",
      );
      if (control && control.parentElement === row) {
        row.insertBefore(el, control);
      } else {
        row.appendChild(el);
      }
    }
  }
  return el;
}

function setSettingRowStatus(row, status, msg) {
  if (!row) return;
  const el = ensureSettingRowStatus(row);
  const prev = settingRowStatusTimers.get(row);
  if (prev) clearTimeout(prev);
  el.className = "setting-save-status";
  if (status) el.classList.add(`is-${status}`);
  if (status === "saving") el.textContent = "保存中…";
  else if (status === "saved") el.textContent = msg || "已保存";
  else if (status === "error") el.textContent = msg || "保存失败";
  else el.textContent = "";
  if (status === "saved") {
    settingRowStatusTimers.set(
      row,
      setTimeout(() => setSettingRowStatus(row, ""), 2000),
    );
  }
}

function bindSubconfigToggles(root) {
  if (!root) return;
  root.querySelectorAll(".setting-subconfig-card").forEach((card) => {
    const head = card.querySelector(".setting-subconfig-head");
    if (!head || head.dataset.subconfigBound) return;
    head.dataset.subconfigBound = "1";
    head.addEventListener("click", () => {
      setSubconfigExpanded(card, !card.classList.contains("is-expanded"));
    });
  });
}

function syncSubconfigPanels(attrName, providerId, fallbackId) {
  const id = (providerId || "").trim() || fallbackId;
  document.querySelectorAll(`[${attrName}]`).forEach((panel) => {
    const match = panel.getAttribute(attrName) === id;
    panel.hidden = !match;
    const card = panel.querySelector(".setting-subconfig-card");
    if (match) {
      setSubconfigExpanded(card, true);
    } else {
      setSubconfigExpanded(card, false);
    }
  });
}

function settingsLabel(row, key) {
  return (row.querySelector(".st") && row.querySelector(".st").textContent) || key;
}

function dropdownChev() {
  return `<svg class="setting-dropdown-chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function dropdownCheck() {
  return `<svg class="setting-dropdown-check" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2.5 7.2l3 3 6-6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function closeAllSettingDropdowns(except) {
  document.querySelectorAll(".setting-dropdown.open").forEach((el) => {
    if (except && el === except) return;
    el.classList.remove("open");
    const menu = el.querySelector(".setting-dropdown-menu");
    if (menu) menu.hidden = true;
  });
}

function bindSettingDropdownOutsideClose() {
  if (document.body.dataset.settingDdBound) return;
  document.body.dataset.settingDdBound = "1";
  document.addEventListener("click", (e) => {
    if (e.target.closest(".setting-dropdown")) return;
    closeAllSettingDropdowns();
  });
}

function dropdownOptionListText(o, config) {
  const key = config && config.listLabelKey;
  if (key && o[key]) return o[key];
  return o.displayName || o.id || "";
}

function mountSettingDropdown(root, options, current, onChange, config = {}) {
  if (!root) return;
  const opts = Array.isArray(options) ? options : [];
  const preserveEmpty = config.preserveEmpty === true;
  const emptyLabel = config.emptyLabel || "";
  const value = preserveEmpty
    ? (current == null ? "" : String(current))
    : current || (opts[0] && opts[0].id) || "";
  const currentOpt =
    opts.find((o) => o.id === value) ||
    (preserveEmpty && value === ""
      ? { id: "", displayName: emptyLabel }
      : null) ||
    opts[0] ||
    { id: value, displayName: value };
  root.dataset.value = value;
  root.innerHTML =
    `<button type="button" class="setting-dropdown-btn" aria-haspopup="listbox" aria-expanded="false">` +
    `<span class="setting-dropdown-label">${esc(currentOpt.displayName || currentOpt.id || "")}</span>` +
    dropdownChev() +
    `</button>` +
    `<div class="setting-dropdown-menu" role="listbox" hidden>` +
    opts
      .map((o) => {
        const active = o.id === value;
        return (
          `<button type="button" class="setting-dropdown-item${active ? " is-active" : ""}" ` +
          `role="option" data-value="${esc(o.id)}" aria-selected="${active ? "true" : "false"}">` +
          `<span>${esc(dropdownOptionListText(o, config))}</span>${dropdownCheck()}</button>`
        );
      })
      .join("") +
    `</div>`;

  const btn = root.querySelector(".setting-dropdown-btn");
  const menu = root.querySelector(".setting-dropdown-menu");
  const label = root.querySelector(".setting-dropdown-label");

  btn.onclick = (e) => {
    e.stopPropagation();
    const open = !root.classList.contains("open");
    closeAllSettingDropdowns(root);
    root.classList.toggle("open", open);
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  };

  menu.querySelectorAll(".setting-dropdown-item").forEach((item) => {
    item.onclick = async (e) => {
      e.stopPropagation();
      const nextVal = item.getAttribute("data-value") || "";
      const prev = root.dataset.value || "";
      if (nextVal === prev) {
        closeAllSettingDropdowns();
        return;
      }
      const opt = opts.find((o) => o.id === nextVal);
      root.dataset.value = nextVal;
      if (label) label.textContent = (opt && (opt.displayName || opt.id)) || nextVal;
      menu.querySelectorAll(".setting-dropdown-item").forEach((el) => {
        const on = el.getAttribute("data-value") === nextVal;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      });
      closeAllSettingDropdowns();
      if (typeof onChange === "function") {
        try {
          await onChange(nextVal, prev);
        } catch (err) {
          root.dataset.value = prev;
          const prevOpt = opts.find((o) => o.id === prev);
          if (label) label.textContent = (prevOpt && (prevOpt.displayName || prevOpt.id)) || prev;
          menu.querySelectorAll(".setting-dropdown-item").forEach((el) => {
            const on = el.getAttribute("data-value") === prev;
            el.classList.toggle("is-active", on);
            el.setAttribute("aria-selected", on ? "true" : "false");
          });
          throw err;
        }
      }
    };
  });
}

function formatModelOptionLabel(m) {
  const base = m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id || m.label;
  return m.default ? `${base}（默认）` : base;
}

let AGENT_PROVIDER_BY_ID = new Map();
let AGENT_PROFILES = [];
let AGENT_EDIT = null;

async function loadAgentProfiles() {
  try {
    AGENT_PROFILES = await api("/api/agents");
  } catch {
    AGENT_PROFILES = [];
  }
  return AGENT_PROFILES;
}

function agentProfileLabel(agent) {
  if (!agent) return "未知 Agent";
  const prov = AGENT_PROVIDER_BY_ID.get(agent.provider) || agent.provider;
  return `${agent.name} · ${prov}`;
}

function agentProfileDropdownOptions(profiles, includeEmpty = false) {
  const opts = (profiles || []).map((a) => ({
    id: a.id,
    displayName: agentProfileLabel(a),
  }));
  if (includeEmpty) opts.unshift({ id: "", displayName: "（继承默认）" });
  return opts;
}

async function renderAgentsPageList() {
  const box = document.getElementById("agentsPageList");
  if (!box) return;
  await loadAgentProfiles();
  let defaultId = "";
  try {
    const s = await api("/api/settings");
    defaultId = (s.defaultAgentId || AGENT_PROFILES[0]?.id || "").trim();
  } catch {
    defaultId = AGENT_PROFILES[0]?.id || "";
  }
  if (!AGENT_PROFILES.length) {
    box.innerHTML =
      '<div class="wf-empty">暂无 Agent。点击「新建 Agent」创建第一个身份配置。</div>';
    return;
  }
  box.innerHTML = AGENT_PROFILES.map((a, i) => {
    const isDefault = a.id === defaultId;
    const initial = esc((a.name || a.provider || "?").trim().charAt(0) || "?");
    const color = ICON_PALETTE[i % ICON_PALETTE.length];
    const meta = [
      AGENT_PROVIDER_BY_ID.get(a.provider) || a.provider,
      a.model || "CLI 默认模型",
      a.defaultSkill && a.defaultSkill !== "default" ? `skill: ${a.defaultSkill}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const ins = (a.instructions || "").trim();
    return `<div class="agent-card">
      <div class="agent-card-icon" style="background:${color}">${initial}</div>
      <div class="agent-card-main">
        <div class="agent-card-name">
          <span>${esc(a.name)}</span>
          ${isDefault ? '<span class="agent-card-badge">默认</span>' : ""}
        </div>
        <div class="agent-card-meta">${esc(meta)}</div>
        ${ins ? `<div class="agent-card-ins">${esc(ins)}</div>` : ""}
      </div>
      <div class="agent-card-actions">
        <button type="button" class="btn-refresh" onclick="openAgentEditor('${esc(a.id)}')">编辑</button>
        <button type="button" class="btn-stop" onclick="deleteAgentProfile('${esc(a.id)}')">删除</button>
      </div>
    </div>`;
  }).join("");
}

async function mountAgentsPageDefaults(state) {
  const s = state || (await api("/api/settings").catch(() => ({})));
  const defaultId = (s.defaultAgentId || AGENT_PROFILES[0]?.id || "").trim();
  const opts = agentProfileDropdownOptions(AGENT_PROFILES);
  const saveSelect = async (key, nextVal) => {
    const next = await saveSettingsPatch({ [key]: nextVal });
    return next;
  };

  const setDefaultEl = document.getElementById("setDefaultAgent");
  if (setDefaultEl) {
    mountSettingDropdown(setDefaultEl, opts, defaultId, async (nextId) => {
      const next = await saveSettingsPatch({ defaultAgentId: nextId });
      toast("已更新：默认 Agent");
      const profile = AGENT_PROFILES.find((a) => a.id === nextId);
      if (profile) {
        const modelOpts = await loadAgentModelOptions(profile.provider);
        mountModelDropdown(
          document.getElementById("setModel"),
          modelOpts,
          profile.model || next.defaultModel || "",
          async (modelVal) => {
            await saveSelect("defaultModel", modelVal);
            toast("已更新：默认模型");
          },
        );
      }
      await renderAgentsPageList();
      await refreshTaskAgentPickers(next);
    });
  }

  const profile = AGENT_PROFILES.find((a) => a.id === defaultId);
  const provider = profile?.provider || s.codingAgent || "claude";
  const modelOpts = await loadAgentModelOptions(provider);
  const initialModel = profile?.model || s.defaultModel || "";
  mountModelDropdown(
    document.getElementById("setModel"),
    modelOpts,
    initialModel,
    async (nextVal) => {
      await saveSelect("defaultModel", nextVal);
      toast("已更新：默认模型");
    },
  );
}

async function loadAgentsPage() {
  if (!AGENT_PROVIDER_BY_ID.size) await refreshAgentProviderCache();
  await refreshRuntimeStatusUI();
  await loadAgentProfiles();
  let state = {};
  try {
    state = await api("/api/settings");
  } catch {
    state = {};
  }
  await mountAgentsPageDefaults(state);
  await renderAgentsPageList();
  await refreshTaskAgentPickers(state);
}

const AUTOPILOT_CRON_PRESETS = [
  { value: "*/15 * * * *", label: "每 15 分钟" },
  { value: "0 * * * *", label: "每小时" },
  { value: "0 9 * * *", label: "每天 09:00" },
  { value: "0 9 * * 1-5", label: "工作日 09:00" },
];

const AUTOPILOT_RUN_STATUS_LABEL = {
  pending: "排队",
  running: "触发中",
  skipped: "已跳过",
  completed: "已触发",
  failed: "失败",
};

let AUTOPILOT_EDIT_ID = "";
let AUTOPILOT_LIST = [];

function cronPresetLabel(expr) {
  const hit = AUTOPILOT_CRON_PRESETS.find((p) => p.value === expr);
  return hit ? hit.label : expr || "-";
}

function renderAutopilotCard(ap) {
  const id = esc(ap.id || "");
  const active = ap.status === "active";
  const last = ap.lastRun;
  const lastBit = last
    ? `${AUTOPILOT_RUN_STATUS_LABEL[last.status] || last.status} · ${fmtTime(last.triggeredAt || last.createdAt)}`
    : "尚未运行";
  const meta = [
    active ? "已启用" : "已暂停",
    cronPresetLabel(ap.cronExpression),
    ap.action === "workflow_run" ? `流程 ${ap.workflowId || "-"}` : `技能 ${ap.skill || "default"}`,
    shortPath(ap.projectDir),
  ]
    .filter((x) => x && x !== "-")
    .join(" · ");
  const schedule = active
    ? `下次 ${fmtTime(ap.nextRunAt)} · 上次 ${lastBit}`
    : `已暂停 · 上次 ${lastBit}`;
  const runbook = String(ap.runbook || "").trim();
  const toggleLabel = active ? "暂停" : "启用";
  const toggleFn = active ? "pauseAutopilot" : "resumeAutopilot";
  return `<div class="ap-card">
    <div class="ap-card-main">
      <div class="ap-card-name">
        <span>${esc(ap.name || ap.id)}</span>
        <span class="log-meta-chip${active ? " status-running" : ""}">${active ? "启用" : "暂停"}</span>
      </div>
      <div class="ap-card-meta">${esc(meta)}</div>
      <div class="ap-card-meta">${esc(schedule)}</div>
      ${runbook ? `<div class="ap-card-runbook">${esc(runbook)}</div>` : ""}
    </div>
    <div class="ap-card-actions">
      <button type="button" class="btn-refresh" onclick="runAutopilotNow('${id}')">立即运行</button>
      <button type="button" class="btn-outline" onclick="${toggleFn}('${id}')">${toggleLabel}</button>
      <button type="button" class="btn-refresh" onclick="openAutopilotEditor('${id}')">编辑</button>
      <button type="button" class="btn-stop" onclick="deleteAutopilot('${id}')">删除</button>
    </div>
  </div>`;
}

async function loadAutopilotsPage() {
  const box = document.getElementById("autopilotsList");
  if (!box) return;
  box.innerHTML = '<div class="wf-empty">加载中…</div>';
  try {
    AUTOPILOT_LIST = await api("/api/autopilots");
    if (!AUTOPILOT_LIST.length) {
      box.innerHTML =
        '<div class="wf-empty">暂无自动化。点击「新建自动化」创建第一条定时规则。</div>';
      return;
    }
    box.innerHTML = AUTOPILOT_LIST.map(renderAutopilotCard).join("");
  } catch (e) {
    box.innerHTML = `<div class="wf-empty">加载失败: ${esc(e.message || e)}</div>`;
  }
}

function onAutopilotEditMaskClick(e) {
  if (e.target.id === "autopilotEditMask") closeAutopilotEditor();
}

function closeAutopilotEditor() {
  const mask = document.getElementById("autopilotEditMask");
  if (mask) mask.classList.remove("show");
  AUTOPILOT_EDIT_ID = "";
}

function onAutopilotActionChange() {
  const action = document.getElementById("ap-ed-action")?.value || "skill_task";
  const skillWrap = document.getElementById("ap-ed-skill-wrap");
  const wfWrap = document.getElementById("ap-ed-wf-wrap");
  if (skillWrap) skillWrap.hidden = action !== "skill_task";
  if (wfWrap) wfWrap.hidden = action !== "workflow_run";
}

function onAutopilotPresetChange() {
  const preset = document.getElementById("ap-ed-preset")?.value || "";
  const wrap = document.getElementById("ap-ed-cron-wrap");
  const cron = document.getElementById("ap-ed-cron");
  const custom = preset === "custom";
  if (wrap) wrap.hidden = !custom;
  if (!custom && cron) cron.value = preset;
  void previewAutopilotCron();
}

async function previewAutopilotCron() {
  const el = document.getElementById("ap-ed-cron-preview");
  if (!el) return;
  const preset = document.getElementById("ap-ed-preset")?.value || "";
  const expression =
    preset === "custom"
      ? (document.getElementById("ap-ed-cron")?.value || "").trim()
      : preset;
  if (!expression) {
    el.textContent = "";
    return;
  }
  try {
    const d = await api("/api/autopilots/cron/preview", {
      method: "POST",
      body: JSON.stringify({ expression, count: 3 }),
    });
    const times = (d.next || []).map((t) => fmtTime(t)).filter(Boolean);
    el.textContent = times.length ? `接下来：${times.join(" · ")}` : "无法计算下次运行时间";
  } catch (e) {
    el.textContent = `Cron 无效：${e.message || e}`;
  }
}

async function fillAutopilotEditorSelects(ap) {
  const skillSel = document.getElementById("ap-ed-skill");
  const wfSel = document.getElementById("ap-ed-workflow");
  const agentSel = document.getElementById("ap-ed-agent");
  if (skillSel) {
    let skills = [];
    try {
      skills = await api("/api/skills");
    } catch {
      skills = [];
    }
    const cur = (ap && ap.skill) || "default";
    const ids = new Set(skills.map((s) => s.id || s.name).filter(Boolean));
    if (cur && !ids.has(cur)) skills = [{ id: cur, name: cur }, ...skills];
    skillSel.innerHTML = (skills.length ? skills : [{ id: "default", name: "default" }])
      .map((s) => {
        const id = s.id || s.name || "default";
        return `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(s.name || id)}</option>`;
      })
      .join("");
  }
  if (wfSel) {
    let wfs = [];
    try {
      wfs = await api("/api/workflows");
    } catch {
      wfs = [];
    }
    const cur = (ap && ap.workflowId) || "";
    wfSel.innerHTML =
      `<option value="">选择流程…</option>` +
      wfs
        .map((w) => {
          const id = w.id || "";
          return `<option value="${esc(id)}"${id === cur ? " selected" : ""}>${esc(w.name || id)}</option>`;
        })
        .join("");
  }
  if (agentSel) {
    await loadAgentProfiles();
    const cur = (ap && ap.agentProfileId) || "";
    agentSel.innerHTML =
      `<option value="">（跟随默认）</option>` +
      AGENT_PROFILES.map((a) => {
        return `<option value="${esc(a.id)}"${a.id === cur ? " selected" : ""}>${esc(agentProfileLabel(a))}</option>`;
      }).join("");
  }
}

async function openAutopilotEditor(id) {
  AUTOPILOT_EDIT_ID = String(id || "").trim();
  let ap = null;
  if (AUTOPILOT_EDIT_ID) {
    try {
      ap = await api(`/api/autopilots/${encodeURIComponent(AUTOPILOT_EDIT_ID)}`);
    } catch (e) {
      toast(`加载失败: ${e.message || e}`);
      return;
    }
  }
  document.getElementById("apEditTitle").textContent = ap ? "编辑自动化" : "新建自动化";
  document.getElementById("ap-ed-name").value = ap?.name || "";
  document.getElementById("ap-ed-runbook").value = ap?.runbook || "";
  document.getElementById("ap-ed-action").value = ap?.action || "skill_task";
  document.getElementById("ap-ed-mode").value = ap?.executionMode || "run_only";
  document.getElementById("ap-ed-status").value = ap?.status === "paused" ? "paused" : "active";
  document.getElementById("ap-ed-dir").value =
    ap?.projectDir || document.getElementById("t-dir")?.value || loadRecentDirs()[0] || "";
  document.getElementById("ap-ed-title").value = ap?.titleTemplate || "{{name}} · {{time}}";
  const cron = ap?.cronExpression || "0 9 * * *";
  const presetEl = document.getElementById("ap-ed-preset");
  const known = AUTOPILOT_CRON_PRESETS.some((p) => p.value === cron);
  if (presetEl) presetEl.value = known ? cron : "custom";
  document.getElementById("ap-ed-cron").value = cron;
  await fillAutopilotEditorSelects(ap);
  onAutopilotActionChange();
  onAutopilotPresetChange();
  document.getElementById("autopilotEditMask").classList.add("show");
}

async function saveAutopilotEditor() {
  const name = (document.getElementById("ap-ed-name").value || "").trim();
  if (!name) return toast("请填写名称");
  const action = document.getElementById("ap-ed-action").value || "skill_task";
  const skill = (document.getElementById("ap-ed-skill").value || "default").trim() || "default";
  const workflowId = (document.getElementById("ap-ed-workflow").value || "").trim();
  if (action === "workflow_run" && !workflowId) return toast("请选择流程");
  const projectDir = (document.getElementById("ap-ed-dir").value || "").trim();
  if (!projectDir) return toast("请填写工作区目录");
  const preset = document.getElementById("ap-ed-preset").value || "";
  const cronExpression =
    preset === "custom"
      ? (document.getElementById("ap-ed-cron").value || "").trim()
      : preset;
  if (!cronExpression) return toast("请填写 cron 表达式");
  const body = {
    name,
    runbook: (document.getElementById("ap-ed-runbook").value || "").trim(),
    action,
    executionMode: document.getElementById("ap-ed-mode").value || "run_only",
    status: document.getElementById("ap-ed-status").value || "active",
    skill,
    workflowId: action === "workflow_run" ? workflowId : "",
    projectDir,
    agentProfileId: (document.getElementById("ap-ed-agent").value || "").trim(),
    titleTemplate: (document.getElementById("ap-ed-title").value || "").trim(),
    cronExpression,
  };
  try {
    if (AUTOPILOT_EDIT_ID) {
      await api(`/api/autopilots/${encodeURIComponent(AUTOPILOT_EDIT_ID)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      toast("已保存");
    } else {
      await api("/api/autopilots", { method: "POST", body: JSON.stringify(body) });
      toast("已创建");
    }
    closeAutopilotEditor();
    await loadAutopilotsPage();
  } catch (e) {
    toast(`保存失败: ${e.message || e}`);
  }
}

async function pauseAutopilot(id) {
  try {
    await api(`/api/autopilots/${encodeURIComponent(id)}/pause`, { method: "POST", body: "{}" });
    toast("已暂停");
    await loadAutopilotsPage();
  } catch (e) {
    toast(`操作失败: ${e.message || e}`);
  }
}

async function resumeAutopilot(id) {
  try {
    await api(`/api/autopilots/${encodeURIComponent(id)}/resume`, { method: "POST", body: "{}" });
    toast("已启用");
    await loadAutopilotsPage();
  } catch (e) {
    toast(`操作失败: ${e.message || e}`);
  }
}

async function runAutopilotNow(id) {
  try {
    const d = await api(`/api/autopilots/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: "{}",
    });
    const taskId = d?.run?.taskId || "";
    toast(taskId ? "已触发，正在打开任务…" : "已触发");
    await loadAutopilotsPage();
    if (taskId) openTaskView(taskId);
  } catch (e) {
    toast(`触发失败: ${e.message || e}`);
  }
}

async function deleteAutopilot(id) {
  if (!window.confirm("确认删除该自动化？")) return;
  try {
    await api(`/api/autopilots/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("已删除");
    await loadAutopilotsPage();
  } catch (e) {
    toast(`删除失败: ${e.message || e}`);
  }
}

function closeAgentEditor() {
  const mask = document.getElementById("agentEditMask");
  if (mask) mask.classList.remove("show");
  closeAllSettingDropdowns();
  AGENT_EDIT = null;
}

const AGENT_INSTRUCTIONS_MAX = 8000;
let agentInstructionsEditorBound = false;

function syncAgentInstructionsUi() {
  const el = document.getElementById("agent-ed-instructions");
  const countEl = document.getElementById("agent-ed-instructions-count");
  if (!el) return;
  const len = (el.value || "").length;
  if (countEl) {
    countEl.textContent = `${len} 字`;
    countEl.classList.toggle("warn", len > AGENT_INSTRUCTIONS_MAX * 0.9);
  }
  el.style.height = "auto";
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 132), 280)}px`;
}

function bindAgentInstructionsEditor() {
  if (agentInstructionsEditorBound) return;
  const el = document.getElementById("agent-ed-instructions");
  if (!el) return;
  agentInstructionsEditorBound = true;
  el.addEventListener("input", syncAgentInstructionsUi);
}

function onAgentEditMaskClick(e) {
  onModalMaskClick(e, () => {
    closeAllSettingDropdowns();
    closeAgentEditor();
  });
}

async function fillAgentSkillOptions(selectedId) {
  const sel = document.getElementById("agent-ed-skill");
  if (!sel) return;
  let rows = [];
  try {
    rows = await api("/api/skills");
  } catch {
    rows = [];
  }
  const opts = [{ id: "default", label: "default（无技能包）" }].concat(
    (Array.isArray(rows) ? rows : []).map((s) => {
      const id = String(s.id || "").trim();
      if (!id || id === "default") return null;
      const desc = String(s.description || "").trim();
      const src = String(s.source || "").trim();
      const label = desc ? `${id} · ${desc}` : src ? `${id} (${src})` : id;
      return { id, label };
    }).filter(Boolean),
  );
  const current = (selectedId || "default").trim() || "default";
  if (!opts.some((o) => o.id === current)) {
    opts.push({ id: current, label: current });
  }
  sel.innerHTML = opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");
  sel.value = current;
}

async function mountAgentEditorModelDropdown(providerId, currentModel) {
  const root = document.getElementById("agent-ed-model");
  if (!root) return;
  const modelOpts = await loadAgentModelOptions(providerId || "claude");
  mountModelDropdown(root, modelOpts, currentModel || "", () => {});
}

function bindAgentEditorProviderChange() {
  const sel = document.getElementById("agent-ed-provider");
  if (!sel || sel.dataset.agentEdProviderBound) return;
  sel.dataset.agentEdProviderBound = "1";
  sel.addEventListener("change", async () => {
    await mountAgentEditorModelDropdown(sel.value, "");
  });
}

async function openAgentEditor(id) {
  await refreshAgentProviderCache();
  const providers = await loadDiscoveredAgentProviders();
  const sel = document.getElementById("agent-ed-provider");
  if (sel) {
    if (!providers.length) {
      sel.innerHTML = '<option value="">（未检测到 CLI）</option>';
    } else {
      sel.innerHTML = providers
        .map((p) => `<option value="${esc(p.id)}">${esc(agentProviderLabel(p))}</option>`)
        .join("");
    }
  }
  bindAgentEditorProviderChange();
  const existing = id ? AGENT_PROFILES.find((a) => a.id === id) : null;
  AGENT_EDIT = { id: existing?.id || "", isNew: !existing };
  document.getElementById("agentEditTitle").textContent = existing ? "编辑 Agent" : "新建 Agent";
  document.getElementById("agent-ed-name").value = existing?.name || "";
  const provider = existing?.provider || providers[0]?.id || "claude";
  if (sel) sel.value = provider;
  await mountAgentEditorModelDropdown(provider, existing?.model || "");
  await fillAgentSkillOptions(existing?.defaultSkill || "default");
  document.getElementById("agent-ed-instructions").value = existing?.instructions || "";
  bindAgentInstructionsEditor();
  syncAgentInstructionsUi();
  document.getElementById("agentEditMask").classList.add("show");
}

async function saveAgentEditor() {
  if (!AGENT_EDIT) return;
  const name = (document.getElementById("agent-ed-name").value || "").trim();
  const provider = (document.getElementById("agent-ed-provider").value || "").trim();
  const model = (document.getElementById("agent-ed-model")?.dataset.value || "").trim();
  const defaultSkill = (document.getElementById("agent-ed-skill").value || "default").trim() || "default";
  const instructions = (document.getElementById("agent-ed-instructions").value || "").trim();
  if (!name) return toast("请填写 Agent 名称");
  if (!provider) return toast("请选择提供方");
  const body = { name, provider, model, defaultSkill, instructions };
  try {
    if (AGENT_EDIT.isNew) {
      await api("/api/agents", { method: "POST", body: JSON.stringify(body) });
    } else {
      await api(`/api/agents/${encodeURIComponent(AGENT_EDIT.id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    }
    toast("Agent 已保存");
    closeAgentEditor();
    await loadAgentProfiles();
    await renderAgentsPageList();
    await refreshTaskAgentPickers();
  } catch (e) {
    toast(`保存失败: ${e.message || e}`);
  }
}

async function deleteAgentProfile(id) {
  if (!id) return;
  if (!confirm("确定删除这个 Agent 身份？")) return;
  try {
    await api(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("已删除");
    await loadAgentProfiles();
    await renderAgentsPageList();
    await refreshTaskAgentPickers();
  } catch (e) {
    toast(`删除失败: ${e.message || e}`);
  }
}

function agentChipLabelForTask(task) {
  const profileId = (tField(task, "agentProfileId", "agent_profile_id") || "").trim();
  if (profileId && AGENT_PROFILES.length) {
    const profile = AGENT_PROFILES.find((a) => a.id === profileId);
    if (profile) return agentProfileLabel(profile);
  }
  const provider = (tField(task, "codingAgent", "coding_agent") || "").trim();
  if (provider) return agentLabelFor(provider) || provider;
  return "";
}

async function refreshTaskAgentPickers(settings) {
  await loadAgentProfiles();
  const s = settings || (await api("/api/settings").catch(() => ({})));
  const defaultId = (s.defaultAgentId || AGENT_PROFILES[0]?.id || "").trim();
  const opts = agentProfileDropdownOptions(AGENT_PROFILES);

  const onTaskAgentChange = async (nextId) => {
    const profile = AGENT_PROFILES.find((a) => a.id === nextId);
    const modelOpts = await loadAgentModelOptions(profile?.provider || s.codingAgent || "claude");
    mountModelDropdown(
      document.getElementById("t-model"),
      modelOpts,
      profile?.model || s.defaultModel || "",
      () => {},
    );
  };

  const taskAgentEl = document.getElementById("t-agent");
  if (taskAgentEl) {
    mountSettingDropdown(taskAgentEl, opts, defaultId, onTaskAgentChange);
  }
}

function getSelectedAgentProfileId() {
  return (document.getElementById("t-agent")?.dataset.value || "").trim();
}

async function refreshAgentProviderCache(fresh = false) {
  const rows = await loadDiscoveredAgentProviders(fresh);
  AGENT_PROVIDER_BY_ID = new Map(rows.map((r) => [r.id, agentProviderLabel(r)]));
}

function agentLabelFor(agentId) {
  return AGENT_PROVIDER_BY_ID.get(agentId) || "";
}

function getReplyModel() {
  return (document.getElementById("reply-model")?.dataset.value || "").trim();
}

async function resolveTaskCodingAgent(task) {
  const fromTask = (tField(task, "codingAgent", "coding_agent") || "").trim();
  if (fromTask) return fromTask;
  try {
    const s = await api("/api/settings");
    return (s.codingAgent || "claude").trim();
  } catch {
    return "claude";
  }
}

async function ensureReplyModelDropdown(task) {
  const root = document.getElementById("reply-model");
  if (!root || !task?.id) return;
  const agentId = await resolveTaskCodingAgent(task);
  const key = `${task.id}|${agentId}`;
  if (key === LOG_REPLY_MODEL_KEY) return;
  LOG_REPLY_MODEL_KEY = key;
  if (!AGENT_PROVIDER_BY_ID.size) await refreshAgentProviderCache();
  const modelOpts = await loadAgentModelOptions(agentId);
  const initialModel = (tField(task, "model", "model") || "").trim();
  mountModelDropdown(root, modelOpts, initialModel, () => {});
}

function mountModelDropdown(root, opts, current, onChange, config = {}) {
  if (!root) return;
  const emptyLabel = config.emptyLabel || "默认";
  const list = Array.isArray(opts) ? [...opts] : [];
  const value = current == null ? "" : String(current);
  if (value && !list.some((o) => o.id === value)) {
    list.unshift({ id: value, displayName: value });
  }
  mountSettingDropdown(root, list, value, onChange, { preserveEmpty: true, emptyLabel });

  const menu = root.querySelector(".setting-dropdown-menu");
  if (!menu) return;

  const customBtn = document.createElement("button");
  customBtn.type = "button";
  customBtn.className = "setting-dropdown-item setting-dropdown-custom";
  customBtn.setAttribute("role", "option");
  customBtn.innerHTML = `<span>自定义模型…</span>`;
  customBtn.onclick = async (e) => {
    e.stopPropagation();
    closeAllSettingDropdowns();
    const typed = window.prompt("输入模型 ID", value || "");
    if (typed == null) return;
    const nextVal = typed.trim();
    if (nextVal === value) return;
    const label = root.querySelector(".setting-dropdown-label");
    root.dataset.value = nextVal;
    if (label) label.textContent = nextVal || emptyLabel;
    if (typeof onChange === "function") await onChange(nextVal, value);
  };
  menu.appendChild(customBtn);

  if (value) {
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "setting-dropdown-item setting-dropdown-custom";
    clearBtn.innerHTML = `<span>清除（使用 CLI 默认）</span>`;
    clearBtn.onclick = async (e) => {
      e.stopPropagation();
      closeAllSettingDropdowns();
      const label = root.querySelector(".setting-dropdown-label");
      root.dataset.value = "";
      if (label) label.textContent = emptyLabel;
      menu.querySelectorAll(".setting-dropdown-item").forEach((el) => {
        el.classList.remove("is-active");
        el.setAttribute("aria-selected", "false");
      });
      if (typeof onChange === "function") await onChange("", value);
    };
    menu.appendChild(clearBtn);
  }
}

async function loadProviderOptions(endpoint, fallback) {
  try {
    const rows = await api(endpoint);
    if (Array.isArray(rows) && rows.length) return rows;
  } catch {
    /* ignore */
  }
  return fallback;
}

async function loadDiscoveredAgentProviders(fresh = false) {
  try {
    const q = fresh ? "?fresh=1" : "";
    const rows = await api(`/api/agent-providers${q}`);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      id: row.id,
      displayName: row.version
        ? `${row.displayName || row.id} (${row.version})`
        : row.displayName || row.id,
      path: row.path,
      version: row.version,
    }));
  } catch {
    return [];
  }
}

async function loadAgentRuntimes(fresh = false) {
  try {
    const q = fresh ? "?fresh=1" : "";
    return await api(`/api/runtimes${q}`);
  } catch {
    return { runtimes: [], installedCount: 0, totalCount: 0, probedAt: 0 };
  }
}

function formatRuntimeProbedAt(ts) {
  if (!ts) return "";
  try {
    return `上次探测 ${new Date(ts).toLocaleString()}`;
  } catch {
    return "";
  }
}

function runtimeCardHtml(row) {
  const installed = !!row.installed;
  const cls = installed ? "is-installed" : "is-missing";
  const status = installed ? "已安装" : "未检测到";
  const version = row.version ? `v${esc(row.version)}` : "";
  const path = row.path ? esc(row.path) : "";
  const cmd = row.command ? `<code>${esc(row.command)}</code>` : "";
  const env = row.envVar
    ? ` · 可用 <code>${esc(row.envVar)}</code> 覆盖`
    : "";
  const metaParts = [status, version, path && `路径 ${path}`, cmd && `命令 ${cmd}${env}`].filter(Boolean);
  const err = !installed && row.error
    ? `<div class="runtime-card-error">${esc(row.error)}</div>`
    : "";
  return `<div class="runtime-card ${cls}">
    <span class="runtime-dot" aria-hidden="true"></span>
    <div class="runtime-card-main">
      <div class="runtime-card-title">${esc(row.displayName || row.id)}</div>
      <div class="runtime-card-meta">${metaParts.join(" · ")}</div>
      ${err}
    </div>
  </div>`;
}

function renderRuntimePanel(panel, data) {
  if (!panel) return;
  const rows = Array.isArray(data?.runtimes) ? data.runtimes : [];
  if (!rows.length) {
    panel.innerHTML =
      '<div class="runtime-empty">未注册任何 Agent 后端。请确认 oh web 已加载 provider 包。</div>';
    return;
  }
  panel.innerHTML = rows.map(runtimeCardHtml).join("");
}

function renderAgentsRuntimeStrip(data) {
  const strip = document.getElementById("agentsRuntimeStrip");
  if (!strip) return;
  const rows = Array.isArray(data?.runtimes) ? data.runtimes : [];
  const installed = Number(data?.installedCount) || 0;
  const total = Number(data?.totalCount) || rows.length;
  if (!rows.length) {
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  if (!installed) {
    strip.className = "runtime-strip is-warn";
    strip.innerHTML =
      '未检测到本机 Agent CLI（<code>claude</code> / <code>codex</code> / <code>agent</code>）。' +
      '请安装并登录后再创建任务。可在<a href="#" onclick="showView(\'settings\');return false;">设置 → 本机 Agent 运行时</a>查看详情。';
    return;
  }
  strip.className = "runtime-strip is-ok";
  const names = rows
    .filter((r) => r.installed)
    .map((r) => `${r.displayName || r.id}${r.version ? ` ${r.version}` : ""}`)
    .join("、");
  strip.textContent = `本机可用 ${installed}/${total} 个运行时：${names}`;
}

let runtimeUiBound = false;

async function refreshRuntimeStatusUI(fresh = false) {
  const panel = document.getElementById("runtimeStatusPanel");
  const probedEl = document.getElementById("runtimeProbedAt");
  if (panel && fresh) {
    panel.innerHTML = '<div class="runtime-loading">正在重新探测…</div>';
  }
  const data = await loadAgentRuntimes(fresh);
  renderRuntimePanel(panel, data);
  if (probedEl) probedEl.textContent = formatRuntimeProbedAt(data.probedAt);
  renderAgentsRuntimeStrip(data);
  return data;
}

function bindRuntimeStatusUI() {
  if (runtimeUiBound) return;
  const btn = document.getElementById("runtimeRefreshBtn");
  if (!btn) return;
  runtimeUiBound = true;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await refreshRuntimeStatusUI(true);
      await refreshAgentProviderCache(true);
      toast("运行时探测已更新");
    } catch (e) {
      toast(`探测失败: ${e.message || e}`);
    } finally {
      btn.disabled = false;
    }
  });
}

function agentProviderLabel(row) {
  return row.displayName || row.id;
}

async function loadAgentModelOptions(agentId) {
  try {
    const data = await api(`/api/agent-models?agent=${encodeURIComponent(agentId || "claude")}`);
    if (!data || data.supported === false) return [];
    const rows = Array.isArray(data.models) ? data.models : [];
    return rows.map((m) => ({
      id: m.id,
      label: m.label,
      default: !!m.default,
      displayName: formatModelOptionLabel(m),
    }));
  } catch {
    return [];
  }
}

async function initSettingsUI() {
  const card = document.getElementById("settingsCard");
  if (!card) return;
  bindSettingDropdownOutsideClose();

  let state = {};
  try {
    state = await api("/api/settings");
  } catch {
    state = {};
  }

  const notifyOpts = await loadProviderOptions("/api/notify-providers", [
    { id: "webhook", displayName: "Webhook" },
    { id: "feishu", displayName: "Feishu / Lark" },
    { id: "dingtalk", displayName: "DingTalk" },
  ]);
  const issueOpts = await loadProviderOptions("/api/issue-providers", [
    { id: "manual", displayName: "Manual (local JSON)" },
    { id: "github", displayName: "GitHub Issues" },
  ]);

  const saveSelect = async (key, nextVal) => {
    let patch;
    if (key === "providers.notify") patch = { providers: { notify: nextVal } };
    else if (key === "providers.issue") patch = { providers: { issue: nextVal } };
    else patch = { [key]: nextVal };
    const next = await saveSettingsPatch(patch);
    state = next;
  };

  const syncNotifyChannelPanels = (providerId) => {
    syncSubconfigPanels("data-notify-panel", providerId, "webhook");
  };

  const syncIssueChannelPanels = (providerId) => {
    syncSubconfigPanels("data-issue-panel", providerId, "manual");
  };

  bindSubconfigToggles(card);

  const initialNotify =
    (state.providers && state.providers.notify) || "webhook";
  syncNotifyChannelPanels(initialNotify);

  const initialIssue =
    (state.providers && state.providers.issue) || "manual";
  syncIssueChannelPanels(initialIssue);

  mountSettingDropdown(
    document.getElementById("setNotifyProvider"),
    notifyOpts,
    initialNotify,
    async (nextVal) => {
      await saveSelect("providers.notify", nextVal);
      syncNotifyChannelPanels(nextVal);
      toast("已更新：通知通道");
    },
  );
  mountSettingDropdown(
    document.getElementById("setIssueProvider"),
    issueOpts,
    initialIssue,
    async (nextVal) => {
      await saveSelect("providers.issue", nextVal);
      syncIssueChannelPanels(nextVal);
      toast("已更新：缺陷来源");
    },
  );

  if (!WORKFLOW_LIST.length) {
    try {
      WORKFLOW_LIST = await api("/api/workflows");
    } catch {
      WORKFLOW_LIST = [];
    }
  }
  const fixWfOpts = [
    { id: "sys-fix-pipeline", displayName: "Fix Pipeline（推荐）" },
    ...WORKFLOW_LIST.filter((w) => w.id !== "sys-fix-pipeline").map((w) => ({
      id: w.id,
      displayName: `${w.name || w.id}${w.source === "system" ? "" : "（个人）"}`,
    })),
    { id: "none", displayName: "单任务（技能模式）" },
  ];
  mountSettingDropdown(
    document.getElementById("setFixWorkflow"),
    fixWfOpts,
    state.defaultFixWorkflowId || "sys-fix-pipeline",
    async (nextVal) => {
      await saveSelect("defaultFixWorkflowId", nextVal);
      toast("已更新：缺陷 AI 修复流程");
    },
  );
  mountSettingDropdown(
    document.getElementById("setWfMode"),
    [
      { id: "shared", displayName: "共享上下文（推荐）" },
      { id: "independent", displayName: "独立执行（高级）" },
    ],
    state.defaultWorkflowMode || "shared",
    async (nextVal) => {
      await saveSelect("defaultWorkflowMode", nextVal);
      toast("已更新：新建流程默认模式");
    },
  );

  bindRuntimeStatusUI();
  void refreshRuntimeStatusUI();

  card.querySelectorAll(".setting-row").forEach((row) => {
    const key = row.dataset.key;
    if (!key) return;
    if (row.dataset.type === "select") return;

    if (row.dataset.type === "text" || row.dataset.type === "secret" || row.dataset.type === "number") {
      const input = row.querySelector("input");
      if (!input) return;
      const isSecret = row.dataset.type === "secret";
      const isNumber = row.dataset.type === "number";
      const loaded = settingsGet(state, key);
      const loadedStr = loaded == null ? "" : String(loaded);
      const hasStoredSecret = isSecret && !!loadedStr;
      input.value = isSecret && loadedStr ? SETTINGS_SECRET_MASK : loadedStr;
      input.dataset.revealed = "0";

      if (isSecret) {
        const toggle = row.querySelector(".setting-secret-toggle");
        if (toggle) {
          const setEye = (visible) => {
            toggle.innerHTML = secretEyeIcon(visible);
            toggle.setAttribute("aria-label", visible ? "隐藏密钥" : "显示密钥");
            toggle.setAttribute("aria-pressed", visible ? "true" : "false");
          };
          setEye(false);
          toggle.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const showing = input.type === "text";
            if (showing) {
              input.type = "password";
              input.dataset.revealed = "0";
              setEye(false);
              return;
            }
            try {
              if (
                input.value === SETTINGS_SECRET_MASK ||
                (hasStoredSecret && !input.value.trim())
              ) {
                const revealed = await api("/api/settings?revealSecrets=1");
                const real = settingsGet(revealed, key);
                const realStr = real == null ? "" : String(real);
                if (realStr && realStr !== SETTINGS_SECRET_MASK) {
                  input.value = realStr;
                  setNestedSettingState(state, key, realStr);
                }
              }
              input.type = "text";
              input.dataset.revealed = "1";
              setEye(true);
            } catch (err) {
              toast(`无法显示密钥: ${(err && err.message) || err}`);
            }
          };
        }
        input.addEventListener("focus", () => {
          if (input.value === SETTINGS_SECRET_MASK) {
            input.value = "";
          }
        });
        input.addEventListener("blur", () => {
          if (
            input.type === "password" &&
            !input.value.trim() &&
            settingsGet(state, key)
          ) {
            input.value = SETTINGS_SECRET_MASK;
          }
        });
      }

      const commit = async () => {
        const prev = settingsGet(state, key);
        const prevStr = prev == null ? "" : String(prev);
        let nextVal = (input.value || "").trim();
        if (isNumber) {
          const n = Number(nextVal);
          if (!Number.isFinite(n)) {
            setSettingRowStatus(row, "error", "请输入数字");
            return;
          }
          if (key === "maxRetries") nextVal = String(Math.min(10, Math.max(0, Math.round(n))));
          else if (key === "retryDelaySec") nextVal = String(Math.max(5, Math.round(n)));
          else nextVal = String(n);
        }
        if (isSecret) {
          if (!nextVal || nextVal === SETTINGS_SECRET_MASK) {
            input.value =
              prevStr && prevStr !== SETTINGS_SECRET_MASK
                ? input.type === "text"
                  ? prevStr
                  : SETTINGS_SECRET_MASK
                : prevStr
                  ? SETTINGS_SECRET_MASK
                  : "";
            setSettingRowStatus(row, "");
            return;
          }
          if (nextVal === prevStr) {
            setSettingRowStatus(row, "");
            return;
          }
        } else if (nextVal === prevStr) {
          setSettingRowStatus(row, "");
          return;
        }
        setSettingRowStatus(row, "saving");
        try {
          const patchVal = isNumber ? Number(nextVal) : nextVal;
          const next = await saveSettingsPatch(settingsPatchForKey(key, patchVal));
          state = next;
          const saved = settingsGet(next, key);
          const savedStr = saved == null ? "" : String(saved);
          if (isSecret && savedStr === SETTINGS_SECRET_MASK) {
            // PUT returns redacted; keep typed plaintext while revealed.
            if (input.dataset.revealed === "1") {
              setNestedSettingState(state, key, nextVal);
              input.value = nextVal;
            } else {
              input.value = SETTINGS_SECRET_MASK;
            }
          } else {
            input.value = isSecret && savedStr ? SETTINGS_SECRET_MASK : savedStr;
          }
          setSettingRowStatus(row, "saved");
        } catch (e) {
          input.value =
            isSecret && prevStr && input.dataset.revealed !== "1"
              ? SETTINGS_SECRET_MASK
              : prevStr;
          setSettingRowStatus(row, "error", "保存失败");
        }
      };
      input.onchange = () => {
        commit();
      };
      input.onblur = () => {
        commit();
      };
      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      };
      return;
    }

    const input = row.querySelector('.toggle input[type="checkbox"]');
    if (!input) return;
    input.checked = !!state[key];
    input.onchange = async () => {
      try {
        const next = await saveSettingsPatch({ [key]: input.checked });
        state = next;
        input.checked = !!next[key];
        toast(`${input.checked ? "已开启：" : "已关闭："}${settingsLabel(row, key)}`);
      } catch (e) {
        input.checked = !input.checked;
        toast(`保存失败: ${e.message || e}`);
      }
    };
  });
}

function showStoppedPage() {
  document.open();
  document.write(
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>服务已停止</title>' +
    '<style>*{box-sizing:border-box}body{margin:0;font-family:-apple-system,sans-serif;background:#f5f5f7;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;color:#1f2329}' +
    '.card{background:#fff;border-radius:20px;padding:40px;text-align:center;box-shadow:0 12px 32px rgba(0,0,0,.08)}' +
    'h1{margin:0 0 10px;font-size:22px}p{color:#80868b;font-size:14px}code{background:#f5f6f8;padding:2px 7px;border-radius:6px}' +
    "</style></head><body><div class=\"card\"><h1>本地服务已停止</h1>" +
    "<p>本地面板已安全退出，可以关闭此浏览器标签页。</p>" +
    "<p style=\"margin-top:16px;font-size:12px;color:#9aa0a6\">下次使用请重新执行 <code>oh web</code> 启动 agent-desk</p>" +
    "</div></body></html>",
  );
  document.close();
}

async function stopProgram() {
  if (!confirm("确定停止本地 oh web 服务？停止后需重新执行 oh web 才能打开本面板。")) return;
  const btn = document.getElementById("btnStop");
  if (btn) btn.disabled = true;
  try {
    await api("/api/shutdown", { method: "POST", body: "{}" });
    toast("服务正在停止…");
    setTimeout(showStoppedPage, 400);
  } catch {
    showStoppedPage();
  }
}

function refreshCurrentView() {
  if (CURRENT_VIEW === "dashboard") return loadDashboard(true);
  if (CURRENT_VIEW === "inbox") return loadInbox(true);
  if (CURRENT_VIEW === "bugs") return loadBugs({ resetPage: false });
  if (CURRENT_VIEW === "tasks-list") return loadTasks(true);
  if (CURRENT_VIEW === "workflows") return loadWorkflows();
  if (CURRENT_VIEW === "skills") return loadSkills();
  if (CURRENT_VIEW === "agents") return loadAgentsPage();
  if (CURRENT_VIEW === "autopilots") return loadAutopilotsPage();
  if (CURRENT_VIEW === "settings") return initSettingsUI();
}

function stopDashPolling() {
  if (DASH_POLL_TIMER) {
    clearInterval(DASH_POLL_TIMER);
    DASH_POLL_TIMER = null;
  }
}

function startDashPolling() {
  stopDashPolling();
  DASH_POLL_TIMER = setInterval(() => {
    if (CURRENT_VIEW === "dashboard" && !document.hidden) loadDashboard(false);
  }, 8000);
}

function dashTaskSub(t) {
  const bits = [];
  if (t.skill) bits.push(t.skill);
  if (t.workflowName) bits.push(t.workflowName);
  if (t.issueCode) bits.push(t.issueCode);
  const when = fmtTime(t.lastActivityAt || t.updatedAt);
  if (when && when !== "-") bits.push(when);
  return bits.join(" · ");
}

function inboxItemSub(item) {
  const bits = [];
  if (item.skill) bits.push(item.skill);
  if (item.workflowName) bits.push(item.workflowName);
  if (item.issueCode) bits.push(item.issueCode);
  if (item.projectDir) bits.push(shortPath(item.projectDir));
  const when = fmtTime(item.lastActivityAt || item.updatedAt);
  if (when && when !== "-") bits.push(when);
  return bits.join(" · ");
}

function renderInboxGateItem(item) {
  const id = esc(item.taskId || "");
  const title = esc(item.title || item.taskId || "-");
  const gate = esc(item.gateHeading || "等待确认");
  const sub = esc(inboxItemSub(item));
  const choices = (item.choices || []).slice(0, 5);
  const choiceBtns = choices
    .map((c) => {
      const val = JSON.stringify(c.value || "");
      const label = esc(c.label || c.value || "");
      return `<button type="button" class="inbox-choice-btn" onclick="openInboxTaskWithReply('${id}', ${val})">${label}</button>`;
    })
    .join("");
  return `<div class="inbox-card">
    <div class="inbox-card-head">
      <span class="tag tag-urgent">待确认</span>
      <div class="inbox-card-body">
        <div class="inbox-card-title" title="${title}">${title}</div>
        <div class="inbox-card-gate">${gate}</div>
        ${sub ? `<div class="inbox-card-sub">${sub}</div>` : ""}
      </div>
      <button type="button" class="btn-outline" onclick="openInboxTask('${id}')">打开</button>
    </div>
    ${choices.length ? `<div class="inbox-card-actions">${choiceBtns}</div>` : ""}
  </div>`;
}

function renderInboxAcceptanceItem(item) {
  const wid = esc(item.workItemId || "");
  const tid = esc(item.taskId || "");
  const title = esc(item.title || item.workItemId || "-");
  const sub = esc(inboxItemSub(item));
  const openBtn = tid
    ? `<button type="button" class="btn-outline" onclick="openInboxResultTask('${tid}')">查看结果</button>`
    : wid
      ? `<button type="button" class="btn-outline" onclick="openWorkItemById('${wid}')">工作项</button>`
      : "";
  return `<div class="inbox-card">
    <div class="inbox-card-head">
      <span class="tag tag-review">待验收</span>
      <div class="inbox-card-body">
        <div class="inbox-card-title" title="${title}">${title}</div>
        <div class="inbox-card-gate is-review">执行已完成，请确认是否验收通过</div>
        ${sub ? `<div class="inbox-card-sub">${sub}</div>` : ""}
      </div>
      ${openBtn}
    </div>
    <div class="inbox-card-actions">
      <button type="button" class="inbox-choice-btn inbox-accept-btn" onclick="acceptWorkItemFromInbox('${wid}')">验收通过</button>
      <button type="button" class="inbox-choice-btn inbox-reject-btn" onclick="rejectWorkItemFromInbox('${wid}')">未通过</button>
    </div>
  </div>`;
}

function renderInboxItem(item) {
  if (item && item.type === "acceptance") return renderInboxAcceptanceItem(item);
  return renderInboxGateItem(item);
}

async function acceptWorkItemFromInbox(workItemId) {
  const id = String(workItemId || "").trim();
  if (!id) return;
  try {
    await api(`/api/work-items/${encodeURIComponent(id)}/accept`, { method: "POST", body: "{}" });
    toast("已验收通过");
    await loadInbox(true);
    if (typeof loadDashboard === "function" && CURRENT_VIEW === "dashboard") loadDashboard();
  } catch (e) {
    toast(`验收失败: ${e.message || e}`);
  }
}

async function rejectWorkItemFromInbox(workItemId) {
  const id = String(workItemId || "").trim();
  if (!id) return;
  const note = window.prompt("未通过原因（可选）", "") ?? null;
  if (note === null) return;
  try {
    await api(`/api/work-items/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ note: String(note || "").trim() }),
    });
    toast("已标记未通过，工作项已重新打开");
    await loadInbox(true);
    if (typeof loadDashboard === "function" && CURRENT_VIEW === "dashboard") loadDashboard();
  } catch (e) {
    toast(`操作失败: ${e.message || e}`);
  }
}

async function loadInbox(force) {
  const list = document.getElementById("inboxList");
  const summary = document.getElementById("inboxSummary");
  if (!list) return;
  if (force) list.innerHTML = '<div class="inbox-empty"><div class="inbox-empty-icon">◈</div>加载中…</div>';
  try {
    const d = await api("/api/inbox");
    const count = d.count ?? (d.items || []).length;
    updateAwaitingNavBadge(count);
    const items = d.items || [];
    const gates = items.filter((it) => it.type !== "acceptance").length;
    const reviews = items.filter((it) => it.type === "acceptance").length;
    if (summary) {
      if (count > 0) {
        const parts = [];
        if (gates) parts.push(`${gates} 项闸门确认`);
        if (reviews) parts.push(`${reviews} 项待验收`);
        summary.innerHTML = `共有 <strong>${count}</strong> 项待你处理（${parts.join("，")}）。`;
      } else {
        summary.innerHTML = "暂无待办，所有任务均无需你立即操作。";
      }
    }
    list.innerHTML = items.length
      ? items.map((item) => renderInboxItem(item)).join("")
      : '<div class="inbox-empty"><div class="inbox-empty-icon">✓</div>暂无待办事项</div>';
  } catch (e) {
    list.innerHTML = `<div class="inbox-empty">加载失败: ${esc(e.message || e)}</div>`;
  }
}

function stopInboxPolling() {
  if (INBOX_POLL_TIMER) {
    clearInterval(INBOX_POLL_TIMER);
    INBOX_POLL_TIMER = null;
  }
}

function startInboxPolling() {
  stopInboxPolling();
  INBOX_POLL_TIMER = setInterval(() => {
    if (CURRENT_VIEW === "inbox" && !document.hidden) loadInbox(false);
  }, 8000);
}

function renderDashTaskItem(t, actionLabel) {
  const id = esc(t.id || "");
  const title = esc(t.title || t.id || "-");
  const sub = esc(dashTaskSub(t));
  const st = t.status || "";
  const tag =
    st === "awaiting"
      ? '<span class="tag tag-urgent">待确认</span>'
      : st === "running"
        ? '<span class="tag tag-normal">运行中</span>'
        : st === "created"
          ? '<span class="tag tag-low">待执行</span>'
          : `<span class="tag tag-low">${esc(STATUS_LABEL[st] || st)}</span>`;
  return `<div class="dash-item">
    ${tag}
    <div class="di-body">
      <div class="di-title" title="${title}">${title}</div>
      ${sub ? `<div class="di-sub">${sub}</div>` : ""}
    </div>
    <button type="button" class="btn-outline" onclick="goToAwaitingTasks('${id}')">${esc(actionLabel)}</button>
  </div>`;
}

function renderDashIssueItem(i) {
  const code = esc(i.code || "");
  const title = esc(i.title || i.code || "-");
  const sev = String(i.severity || "medium").toLowerCase();
  const sevLabel = esc(i.severity || "medium");
  const when = esc(fmtTime(i.updatedAt));
  const codeAttr = esc(i.code || "").replace(/'/g, "\\'");
  const related = relatedTaskForIssue(i.code);
  const busy =
    related && ["running", "awaiting", "created", "preparing", "queued"].includes(String(related.status || ""));
  let ops = "";
  if (busy) {
    ops =
      `<button type="button" class="btn-outline" disabled title="已有关联任务进行中">AI 修复</button>` +
      `<button type="button" class="btn-outline" onclick="openWorkItemByIssue('${codeAttr}')">工作项</button>`;
  } else {
    ops = `<button type="button" class="btn-outline" onclick="startTaskFromIssue('${codeAttr}')">AI 修复</button>`;
    const execCount = executionCountForIssue(i.code);
    if (execCount > 0) {
      ops += `<button type="button" class="btn-outline" onclick="openWorkItemByIssue('${codeAttr}')">工作项 (${execCount})</button>`;
    }
  }
  return `<div class="dash-item">
    <span class="badge sev-${esc(sev)}">${sevLabel}</span>
    <div class="di-body">
      <div class="di-title" title="${title}"><span class="bug-code">${code}</span> ${title}</div>
      <div class="di-sub">${when}</div>
    </div>
    ${ops}
  </div>`;
}

function normalizeIssueCode(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "");
}

function tasksForIssue(code) {
  const key = normalizeIssueCode(code);
  if (!key) return [];
  return (TASKS || []).filter((t) => normalizeIssueCode(tField(t, "issueCode", "issue_code")) === key);
}

function relatedTaskForIssue(code) {
  const rows = tasksForIssue(code);
  if (!rows.length) return null;
  const busy = rows.find((t) =>
    ["running", "awaiting", "created", "preparing", "queued"].includes(String(t.status || "")),
  );
  if (busy) return busy;
  return rows
    .slice()
    .sort(
      (a, b) =>
        Number(b.lastActivityAt || b.updatedAt || 0) - Number(a.lastActivityAt || a.updatedAt || 0),
    )[0];
}

function executionCountForIssue(code) {
  return tasksForIssue(code).length;
}

function resetWorkItemModalShell(loadingText) {
  const mask = document.getElementById("workItemMask");
  const timeline = document.getElementById("workItemTimeline");
  const detail = document.getElementById("workItemDetail");
  const tasks = document.getElementById("workItemTasks");
  const tasksHead = document.getElementById("workItemTasksHead");
  const reviewBar = document.getElementById("workItemReviewBar");
  const noteInput = document.getElementById("workItemNoteInput");
  if (mask) mask.classList.add("show");
  if (timeline) timeline.innerHTML = `<div class="work-item-loading">${loadingText || "加载中…"}</div>`;
  if (detail) {
    detail.hidden = true;
    detail.innerHTML = "";
  }
  if (tasks) {
    tasks.hidden = true;
    tasks.innerHTML = "";
  }
  if (tasksHead) tasksHead.hidden = true;
  if (reviewBar) {
    reviewBar.hidden = true;
    reviewBar.innerHTML = "";
  }
  if (noteInput) noteInput.value = "";
}

async function openWorkItemByIssue(code) {
  const c = String(code || "").trim();
  if (!c) return;
  resetWorkItemModalShell();
  document.getElementById("workItemTitle").textContent = "工作项";
  document.getElementById("workItemMeta").innerHTML = "";
  WORK_ITEM_MODAL_ID = "";
  try {
    const data = await api(`/api/issues/${encodeURIComponent(c)}/work-item`);
    renderWorkItemModal(data);
  } catch (e) {
    const timeline = document.getElementById("workItemTimeline");
    if (timeline) {
      timeline.innerHTML = `<div class="work-item-empty">${esc(e.message || "加载失败")}</div>`;
    }
  }
}

async function openWorkItemById(id) {
  const wid = String(id || "").trim();
  if (!wid) return;
  resetWorkItemModalShell();
  WORK_ITEM_MODAL_ID = wid;
  try {
    const data = await api(`/api/work-items/${encodeURIComponent(wid)}`);
    renderWorkItemModal(data);
  } catch (e) {
    const timeline = document.getElementById("workItemTimeline");
    if (timeline) {
      timeline.innerHTML = `<div class="work-item-empty">${esc(e.message || "加载失败")}</div>`;
    }
  }
}

function clipWorkItemText(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const n = Math.max(40, Number(max) || 180);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function openWorkItemTask(taskId) {
  if (!taskId) return;
  closeWorkItemModal();
  openTaskView(taskId);
}

function renderWorkItemDetail(item, issue) {
  const box = document.getElementById("workItemDetail");
  if (!box) return;
  const code = String(item.issueCode || (issue && issue.code) || "").trim();
  const url = (issue && issue.url) || "";
  const rows = [];
  if (issue && issue.status) rows.push(["缺陷状态", esc(issue.status)]);
  if (issue && issue.severity) rows.push(["严重程度", esc(issue.severity)]);
  const proj = shortPath(item.projectDir || (issue && issue.projectDir) || "");
  if (proj && proj !== "-") {
    rows.push(["工作区", `<span title="${esc(item.projectDir || "")}">${esc(proj)}</span>`]);
  }
  if (issue && Array.isArray(issue.labels) && issue.labels.length) {
    rows.push(["标签", esc(issue.labels.join(", "))]);
  }
  const bodyRaw = String((issue && issue.description) || item.description || "").trim();
  const bodyEmpty = !bodyRaw;
  const body = bodyRaw || "暂无 Issue 描述。";
  const summaryBits = [];
  summaryBits.push(`<span class="work-item-issue-label">来源 Issue</span>`);
  if (code) {
    summaryBits.push(
      url
        ? `<a class="work-item-issue-link" href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(code)}</a>`
        : `<span class="work-item-issue-link">${esc(code)}</span>`,
    );
  }
  if (issue && issue.status) {
    summaryBits.push(`<span class="work-item-issue-meta">· ${esc(issue.status)}</span>`);
  } else if (issue && issue.severity) {
    summaryBits.push(`<span class="work-item-issue-meta">· ${esc(issue.severity)}</span>`);
  }
  box.innerHTML =
    `<details class="work-item-issue-source">` +
    `<summary>${summaryBits.join(" ")}</summary>` +
    `<div class="work-item-issue-panel">` +
    (rows.length
      ? `<div class="work-item-detail-grid">${rows
          .map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`)
          .join("")}</div>`
      : "") +
    `<div class="work-item-detail-body${bodyEmpty ? " is-empty" : ""}">${esc(body)}</div>` +
    `</div></details>`;
  box.hidden = false;
}

function renderWorkItemTasks(tasks) {
  const box = document.getElementById("workItemTasks");
  const head = document.getElementById("workItemTasksHead");
  if (!box) return;
  const list = (tasks || [])
    .slice()
    .sort(
      (a, b) =>
        Number(b.lastActivityAt || b.updatedAt || b.createdAt || 0) -
        Number(a.lastActivityAt || a.updatedAt || a.createdAt || 0),
    );
  if (!list.length) {
    box.hidden = true;
    box.innerHTML = "";
    if (head) head.hidden = true;
    return;
  }
  if (head) head.hidden = false;
  box.hidden = false;
  box.innerHTML = list
    .map((t) => {
      const st = String(t.status || "");
      const chips = [];
      const skill = String(tField(t, "skill", "skill") || "").trim();
      if (skill) chips.push(`<span class="log-meta-chip">技能 ${esc(skill)}</span>`);
      const wf = String(tField(t, "workflowName", "workflow_name") || "").trim();
      const step = Number(tField(t, "workflowStep", "workflow_step") || 0);
      const total = Number(tField(t, "workflowStepTotal", "workflow_step_total") || 0);
      if (wf) {
        chips.push(
          `<span class="log-meta-chip">${esc(wf)}${total > 0 ? ` · ${step}/${total}` : ""}</span>`,
        );
      }
      const agentChip = typeof agentChipLabelForTask === "function" ? agentChipLabelForTask(t) : "";
      if (agentChip) chips.push(`<span class="log-meta-chip">${esc(agentChip)}</span>`);
      const model = String(tField(t, "model", "model") || "").trim();
      if (model) chips.push(`<span class="log-meta-chip">${esc(model)}</span>`);
      const retryCount = Number(tField(t, "retryCount", "retry_count") || 0);
      if (retryCount > 0) chips.push(`<span class="log-meta-chip">重试 ${retryCount}</span>`);
      const failureCode = String(tField(t, "failureCode", "failure_code") || "").trim();
      if (failureCode) {
        chips.push(
          `<span class="log-meta-chip log-meta-fail" title="${esc(
            tField(t, "failureMessage", "failure_message"),
          )}">${esc(FAILURE_CODE_LABEL[failureCode] || failureCode)}</span>`,
        );
      }
      const when = fmtTime(t.lastActivityAt || t.updatedAt || t.createdAt);
      return `<div class="work-item-task" data-task="${esc(t.id)}" role="button" tabindex="0" title="打开会话查看任务描述">
        <div class="work-item-task-main">
          <div class="work-item-task-title">${esc(t.title || t.id)}</div>
          ${chips.length ? `<div class="work-item-task-chips">${chips.join("")}</div>` : ""}
          <div class="work-item-task-when">${esc(when)}</div>
        </div>
        <span class="work-item-task-status log-meta-chip status-${esc(st)}">${esc(STATUS_LABEL[st] || st)}</span>
      </div>`;
    })
    .join("");

  box.querySelectorAll(".work-item-task").forEach((row) => {
    const go = () => openWorkItemTask(row.dataset.task);
    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });
  });
}

function buildWorkItemDiscussionItems(tasks, events) {
  const runIds = new Set((tasks || []).map((t) => t.id));
  return (events || [])
    .filter((ev) => {
      const kind = String(ev.kind || "");
      if (kind === "run_linked" && runIds.has(ev.taskId)) return false;
      return true;
    })
    .slice()
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function renderWorkItemTimeline(tasks, events) {
  const box = document.getElementById("workItemTimeline");
  if (!box) return;
  const items = buildWorkItemDiscussionItems(tasks, events);
  if (!items.length) {
    box.innerHTML =
      `<div class="work-item-empty">` +
      `<strong>还没有讨论记录</strong>` +
      `<p class="work-item-empty-sub">闸门确认会自动写入；也可以在下方记下决策或下一步。</p>` +
      `</div>`;
    return;
  }
  box.innerHTML = items
    .map((ev) => {
      const kind = String(ev.kind || "note");
      const kindCls =
        kind === "gate_reply"
          ? "is-gate"
          : kind === "run_linked"
            ? "is-run"
            : kind === "system"
              ? "is-system"
              : "is-note";
      const kindLabel = WORK_ITEM_EVENT_KIND_LABEL[kind] || kind;
      const when = fmtTime(ev.createdAt);
      const taskBtn = ev.taskId
        ? `<button type="button" class="work-item-event-task" data-task="${esc(ev.taskId)}">查看相关任务</button>`
        : "";
      return `<div class="work-item-event ${kindCls}">
        <span class="work-item-event-rail" aria-hidden="true"></span>
        <div class="work-item-event-main">
          <div class="work-item-event-head">
            <span class="work-item-event-kind">${esc(kindLabel)}</span>
            <span>${esc(when)}</span>
          </div>
          <div class="work-item-event-body">${esc(ev.body || "")}</div>
          ${taskBtn}
        </div>
      </div>`;
    })
    .join("");

  box.querySelectorAll(".work-item-event-task").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openWorkItemTask(btn.dataset.task);
    });
  });
  box.scrollTop = box.scrollHeight;
}

function renderWorkItemReviewBar(item) {
  const bar = document.getElementById("workItemReviewBar");
  if (!bar) return;
  if (!item || item.status !== "in_review") {
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  const id = esc(item.id || "");
  bar.innerHTML =
    `<span class="work-item-review-text">执行已完成，等待你验收</span>` +
    `<div class="work-item-review-actions">` +
    `<button type="button" class="inbox-choice-btn inbox-accept-btn" onclick="acceptWorkItemFromModal('${id}')">验收通过</button>` +
    `<button type="button" class="inbox-choice-btn inbox-reject-btn" onclick="rejectWorkItemFromModal('${id}')">未通过</button>` +
    `</div>`;
  bar.hidden = false;
}

async function acceptWorkItemFromModal(workItemId) {
  const id = String(workItemId || WORK_ITEM_MODAL_ID || "").trim();
  if (!id) return;
  try {
    await api(`/api/work-items/${encodeURIComponent(id)}/accept`, { method: "POST", body: "{}" });
    toast("已验收通过");
    const data = await api(`/api/work-items/${encodeURIComponent(id)}`);
    renderWorkItemModal(data);
  } catch (e) {
    toast(`验收失败: ${e.message || e}`);
  }
}

async function rejectWorkItemFromModal(workItemId) {
  const id = String(workItemId || WORK_ITEM_MODAL_ID || "").trim();
  if (!id) return;
  const note = window.prompt("未通过原因（可选）", "") ?? null;
  if (note === null) return;
  try {
    await api(`/api/work-items/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: JSON.stringify({ note: String(note || "").trim() }),
    });
    toast("已标记未通过，工作项已重新打开");
    const data = await api(`/api/work-items/${encodeURIComponent(id)}`);
    renderWorkItemModal(data);
  } catch (e) {
    toast(`操作失败: ${e.message || e}`);
  }
}

function renderWorkItemModal(data) {
  const item = data?.workItem;
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const events = Array.isArray(data?.events) ? data.events : [];
  const issue = data?.issue || null;
  if (!item) return;
  WORK_ITEM_MODAL_ID = item.id || "";
  const titleEl = document.getElementById("workItemTitle");
  const metaEl = document.getElementById("workItemMeta");
  if (titleEl) titleEl.textContent = item.title || item.issueCode || "工作项";
  if (metaEl) {
    const chips = [];
    const st = item.status || "open";
    const stCls = st === "in_review" ? " status-awaiting" : st === "done" ? " status-done" : "";
    chips.push(`<span class="log-meta-chip${stCls}">${esc(WORK_ITEM_STATUS_LABEL[st] || st)}</span>`);
    if (item.issueCode) chips.push(`<span class="log-meta-chip bug-code">${esc(item.issueCode)}</span>`);
    const proj = shortPath(item.projectDir || "");
    if (proj && proj !== "-") {
      chips.push(`<span class="log-meta-chip" title="${esc(item.projectDir || "")}">${esc(proj)}</span>`);
    }
    chips.push(`<span class="log-meta-chip">${tasks.length} 个任务</span>`);
    const discussionCount = events.filter((e) => e.kind !== "run_linked").length;
    if (discussionCount) chips.push(`<span class="log-meta-chip">${discussionCount} 条讨论</span>`);
    metaEl.innerHTML = chips.join("");
  }
  renderWorkItemReviewBar(item);
  renderWorkItemDetail(item, issue);
  renderWorkItemTasks(tasks);
  renderWorkItemTimeline(tasks, events);
}

function closeWorkItemModal() {
  const mask = document.getElementById("workItemMask");
  if (mask) mask.classList.remove("show");
  WORK_ITEM_MODAL_ID = "";
  WORK_ITEM_NOTE_SENDING = false;
  setWorkItemNoteSending(false);
}

function onWorkItemMaskClick(e) {
  if (e.target.id === "workItemMask") closeWorkItemModal();
}

function onWorkItemNoteKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    if (typeof isImeComposingKeyEvent === "function" && isImeComposingKeyEvent(e)) return;
    if (WORK_ITEM_NOTE_SENDING) return;
    e.preventDefault();
    void submitWorkItemNote();
  }
}

function setWorkItemNoteSending(busy) {
  const input = document.getElementById("workItemNoteInput");
  const btn = document.getElementById("workItemNoteBtn");
  if (input) {
    input.disabled = !!busy;
    input.placeholder = busy
      ? "正在添加备注…"
      : "记下决策、上下文或下一步… Enter 发送，Shift+Enter 换行";
  }
  if (btn) {
    btn.disabled = !!busy;
    btn.setAttribute("aria-busy", busy ? "true" : "false");
    btn.title = busy ? "添加中…" : "添加备注";
  }
}

async function submitWorkItemNote() {
  const id = WORK_ITEM_MODAL_ID;
  const input = document.getElementById("workItemNoteInput");
  if (!id || !input || WORK_ITEM_NOTE_SENDING) return;
  const body = (input.value || "").trim();
  if (!body) return toast("请填写备注内容");
  WORK_ITEM_NOTE_SENDING = true;
  setWorkItemNoteSending(true);
  try {
    await api(`/api/work-items/${encodeURIComponent(id)}/events`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    input.value = "";
    const data = await api(`/api/work-items/${encodeURIComponent(id)}`);
    renderWorkItemModal(data);
    toast("备注已添加");
  } catch (e) {
    toast(`添加失败: ${e.message || e}`);
  } finally {
    WORK_ITEM_NOTE_SENDING = false;
    setWorkItemNoteSending(false);
  }
}

function openIssueTask(taskId) {
  openTaskView(taskId);
}

function severityBadge(sev) {
  const s = String(sev || "medium").toLowerCase();
  const known = ["critical", "high", "medium", "low"].includes(s) ? s : "unknown";
  return `<span class="badge sev-${known}">${esc(sev || "medium")}</span>`;
}

function statusBadge(st) {
  const s = String(st || "open").toLowerCase();
  const cls = s === "closed" ? "closed" : "open";
  return `<span class="badge ${cls}">${esc(st || "open")}</span>`;
}

function matchBugSearch(b, kw) {
  if (!kw) return true;
  const labels = (b.labels || []).join(" ");
  const hay = [b.code, b.title, b.description, b.status, b.severity, labels, b.projectDir]
    .join(" ")
    .toLowerCase();
  return hay.includes(kw);
}

function renderBugPager(total, page, pageSize) {
  const pager = document.getElementById("bugPager");
  if (!pager) return;
  if (!total) {
    pager.innerHTML = "";
    return;
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pages);
  if (pages <= 1) {
    pager.innerHTML = `<span class="task-pager-info">共 ${total} 条</span>`;
    return;
  }
  const from = (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);
  pager.innerHTML =
    `<span class="task-pager-info">共 ${total} 条，当前 ${from}–${to}</span>` +
    `<button type="button" id="bugPgPrev"${cur <= 1 ? " disabled" : ""}>上一页</button>` +
    `<span class="pg-num">${cur} / ${pages}</span>` +
    `<button type="button" id="bugPgNext"${cur >= pages ? " disabled" : ""}>下一页</button>`;
  const prev = document.getElementById("bugPgPrev");
  const next = document.getElementById("bugPgNext");
  if (prev) prev.onclick = () => {
    BUG_PAGE = cur - 1;
    renderBugs();
  };
  if (next) next.onclick = () => {
    BUG_PAGE = cur + 1;
    renderBugs();
  };
}

function renderBugs() {
  const box = document.getElementById("bug-list");
  if (!box) return;
  const kw = BUG_FILTER_KW;
  const list = (BUGS || []).filter((b) => matchBugSearch(b, kw));
  if (!list.length) {
    box.innerHTML = '<div class="bug-empty">暂无缺陷</div>';
    renderBugPager(0, 1, BUG_PAGE_SIZE);
    return;
  }
  const pages = Math.max(1, Math.ceil(list.length / BUG_PAGE_SIZE));
  if (BUG_PAGE > pages) BUG_PAGE = pages;
  if (BUG_PAGE < 1) BUG_PAGE = 1;
  const start = (BUG_PAGE - 1) * BUG_PAGE_SIZE;
  const pageList = list.slice(start, start + BUG_PAGE_SIZE);
  const rows = pageList
    .map((b) => {
      const code = esc(b.code || "");
      const codeAttr = esc(b.code || "").replace(/'/g, "\\'");
      const title = esc(b.title || "");
      const labels = (b.labels || []).map((l) => esc(l)).join(", ");
      const when = esc(fmtTime(b.updatedAt));
      const url = (b.url || "").trim();
      const link = url
        ? `<a class="bug-code" href="${esc(url)}" target="_blank" rel="noopener">${code}</a>`
        : `<span class="bug-code">${code}</span>`;
      const execCount = executionCountForIssue(b.code);
      const related = relatedTaskForIssue(b.code);
      const busy = related && ["running", "awaiting", "created", "preparing", "queued"].includes(String(related.status || ""));
      let ops = `<span class="bug-ops">`;
      if (busy) {
        ops +=
          `<button type="button" class="btn-fix" disabled title="已有关联任务进行中">AI 修复</button>` +
          `<button type="button" class="btn-task" data-issue="${codeAttr}">工作项</button>`;
      } else {
        ops += `<button type="button" class="btn-fix" data-code="${codeAttr}">AI 修复</button>`;
        if (execCount > 0) {
          ops += `<button type="button" class="btn-task" data-issue="${codeAttr}">工作项 (${execCount})</button>`;
        }
      }
      ops += `</span>`;
      const relatedCell = execCount
        ? `<button type="button" class="bug-link-btn" data-issue="${codeAttr}" title="查看执行记录">${execCount} 次</button>`
        : '<span class="muted">-</span>';
      return (
        `<tr>` +
        `<td>${link}</td>` +
        `<td>${statusBadge(b.status)}</td>` +
        `<td>${severityBadge(b.severity)}</td>` +
        `<td title="${title}">${title}</td>` +
        `<td>${relatedCell}</td>` +
        `<td>${when}</td>` +
        `<td>${ops}</td>` +
        `</tr>`
      );
    })
    .join("");
  box.innerHTML =
    '<table class="bug-table"><thead><tr>' +
    "<th>编号</th><th>状态</th><th>严重程度</th><th>标题</th><th>执行</th><th>更新</th><th>操作</th>" +
    `</tr></thead><tbody>${rows}</tbody></table>`;
  renderBugPager(list.length, BUG_PAGE, BUG_PAGE_SIZE);
  box.querySelectorAll(".btn-fix").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      startTaskFromIssue(btn.dataset.code);
    });
  });
  box.querySelectorAll(".btn-task[data-issue]").forEach((btn) => {
    btn.addEventListener("click", () => openWorkItemByIssue(btn.dataset.issue));
  });
  box.querySelectorAll(".bug-link-btn[data-issue]").forEach((btn) => {
    btn.addEventListener("click", () => openWorkItemByIssue(btn.dataset.issue));
  });
}

async function loadBugs(opts = {}) {
  const box = document.getElementById("bug-list");
  if (!box) return;
  if (opts.resetPage) BUG_PAGE = 1;
  const qEl = document.getElementById("bug-q");
  const stateEl = document.getElementById("bug-state");
  BUG_FILTER_KW = ((qEl && qEl.value) || "").trim().toLowerCase();
  const state = ((stateEl && stateEl.value) || "all").trim();
  box.innerHTML = '<div class="bug-loading">加载中…</div>';
  try {
    const [rows, tasks] = await Promise.all([
      api(`/api/issues?state=${encodeURIComponent(state)}&limit=100`),
      api("/api/tasks").catch(() => TASKS || []),
    ]);
    BUGS = Array.isArray(rows) ? rows : [];
    if (Array.isArray(tasks)) TASKS = tasks;
    BUGS.forEach((i) => {
      if (i && i.code) ISSUE_CACHE.set(String(i.code), i);
    });
    renderBugs();
  } catch (e) {
    BUGS = [];
    box.innerHTML = `<div class="bug-empty">加载失败: ${esc(e.message || e)}</div>`;
    renderBugPager(0, 1, BUG_PAGE_SIZE);
  }
}

async function startTaskFromIssue(code) {
  let issue =
    ISSUE_CACHE.get(String(code)) ||
    (BUGS || []).find((b) => String(b.code) === String(code)) ||
    { code, title: code };
  try {
    const full = await api(`/api/issues/${encodeURIComponent(code)}`);
    if (full && full.code) {
      issue = full;
      ISSUE_CACHE.set(String(full.code), full);
    }
  } catch {
    /* use cached / minimal */
  }
  const title = `${issue.code} ${issue.title || ""}`.trim().slice(0, TITLE_MAX);
  const desc = (issue.description || "").trim();
  const prompt = [
    `请修复缺陷 ${issue.code}：${issue.title || ""}`,
    desc ? `\n\n描述：\n${desc}` : "",
    issue.url ? `\n\n链接：${issue.url}` : "",
  ]
    .join("")
    .slice(0, PROMPT_MAX);

  const projectDir =
    (issue.projectDir || "").trim() ||
    (await resolveIssueProjectDir()) ||
    (document.getElementById("t-dir")?.value || "").trim() ||
    (loadRecentDirs()[0] || "");

  async function resolveIssueProjectDir() {
    try {
      const settings = await api("/api/settings");
      if ((settings.providers?.issue || "manual") !== "github") return "";
      const ws = await api("/api/github/resolve-workspace", { method: "POST" });
      if (ws?.projectDir) {
        toast(
          ws.source === "cloned"
            ? `已克隆仓库到工作区：${shortPath(ws.projectDir)}`
            : ws.source === "discovered" || ws.source === "env"
              ? `已使用本地仓库：${shortPath(ws.projectDir)}`
              : `已使用工作区：${shortPath(ws.projectDir)}`,
        );
        return String(ws.projectDir);
      }
    } catch (e) {
      console.warn("resolve workspace failed", e);
    }
    return "";
  }

  let settings = {};
  try {
    settings = await api("/api/settings");
  } catch {
    /* ignore */
  }
  const wfId = String(settings.defaultFixWorkflowId || "sys-fix-pipeline").trim();
  const usePipeline = wfId && wfId !== "none";

  const fillSkillComposer = () => {
    switchView("tasks-new");
    const mode = document.getElementById("t-mode");
    if (mode) {
      mode.value = "skill";
      onTaskTypeChange();
    }
    const titleEl = document.getElementById("t-title");
    if (titleEl) titleEl.value = title;
    const promptEl = document.getElementById("t-prompt");
    if (promptEl) {
      promptEl.value = prompt;
      onTaskPromptInput();
    }
    const issueEl = document.getElementById("t-issue-code");
    if (issueEl) issueEl.value = issue.code || code || "";
    if (projectDir) {
      const dirEl = document.getElementById("t-dir");
      if (dirEl) dirEl.value = projectDir;
      syncWorkspaceLabel();
    }
    fillSkillOptions().then(() => {
      const pick = ["fix", "bug-fix", "triage"].find((id) =>
        TASK_SKILL_OPTS.some((o) => o.id === id),
      );
      if (pick) fillSkillOptions(pick);
    });
  };

  if (usePipeline) {
    const purpose = {
      type: "workflow",
      workflowId: wfId,
      title,
      prompt,
      issueCode: issue.code || code,
    };
    if (!projectDir) {
      openWorkspacePicker(null, purpose);
      toast(`请选择工作区以启动流程「${wfId}」`);
      return;
    }
    try {
      const run = await startWorkflowRun(wfId, {
        projectDir,
        title,
        prompt,
        issueCode: issue.code || code,
      });
      toast(`已启动流程 ${wfId}，正在打开任务…`);
      switchView("tasks-list");
      if (run.parentTaskId) showLog(run.parentTaskId);
      return;
    } catch (e) {
      const detail = explainWorkflowStartError(e, wfId);
      toast(detail);
      if (confirm(`${detail}\n\n是否改为技能模式手动创建任务？`)) {
        fillSkillComposer();
        toast(`已填入缺陷 ${issue.code || code}（技能模式）`);
      }
      return;
    }
  }

  fillSkillComposer();
  toast(`已填入缺陷 ${issue.code || code}`);
}

async function loadDashboard(force) {
  const awaitingBox = document.getElementById("dash-awaiting-tasks");
  const issuesBox = document.getElementById("dash-open-issues-list");
  if (!awaitingBox || !issuesBox) return;
  if (force) {
    awaitingBox.innerHTML = '<div class="dash-empty">加载中…</div>';
    issuesBox.innerHTML = '<div class="dash-empty">加载中…</div>';
  }
  try {
    const [d, tasks] = await Promise.all([
      api("/api/dashboard"),
      api("/api/tasks").catch(() => TASKS || []),
    ]);
    if (Array.isArray(tasks)) TASKS = tasks;
    const setNum = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(n ?? 0);
    };
    setNum("dash-open-issues", d.open_issue_count);
    setNum("dash-awaiting", d.inbox_count ?? ((d.awaiting_count || 0) + (d.in_review_count || 0)));
    updateAwaitingNavBadge(d.inbox_count ?? ((d.awaiting_count || 0) + (d.in_review_count || 0)));
    setNum("dash-active", d.active_count);
    setNum("dash-done-week", d.done_week_count);

    const openIssues = d.open_issues || [];
    openIssues.forEach((i) => {
      if (i && i.code) ISSUE_CACHE.set(String(i.code), i);
    });
    issuesBox.innerHTML = openIssues.length
      ? openIssues.map((i) => renderDashIssueItem(i)).join("")
      : '<div class="dash-empty">暂无开放缺陷</div>';

    const awaiting = d.awaiting_tasks || [];
    const reviews = d.in_review_items || [];
    const todoBits = [];
    if (awaiting.length) {
      todoBits.push(...awaiting.map((t) => renderDashTaskItem(t, "处理")));
    }
    if (reviews.length) {
      todoBits.push(
        ...reviews.map((w) => {
          const id = esc(w.id || "");
          const title = esc(w.title || w.id || "-");
          const sub = esc(
            [w.issueCode, shortPath(w.projectDir), fmtTime(w.lastActivityAt || w.updatedAt)]
              .filter((x) => x && x !== "-")
              .join(" · "),
          );
          return `<div class="dash-item">
            <span class="tag tag-review">待验收</span>
            <div class="di-body">
              <div class="di-title" title="${title}">${title}</div>
              ${sub ? `<div class="di-sub">${sub}</div>` : ""}
            </div>
            <button type="button" class="btn-outline" onclick="openWorkItemById('${id}')">验收</button>
          </div>`;
        }),
      );
    }
    awaitingBox.innerHTML = todoBits.length
      ? todoBits.join("")
      : '<div class="dash-empty">暂无待办事项</div>';
  } catch (e) {
    awaitingBox.innerHTML = `<div class="dash-empty">加载失败: ${esc(e.message || e)}</div>`;
    issuesBox.innerHTML = "";
  }
}

function switchView(view, opts = {}) {
  if (view !== "tasks-list" && LOG_ID) closeLog();
  if (view !== "tasks-list") stopTaskPolling();
  if (view !== "dashboard") stopDashPolling();
  if (view !== "inbox") stopInboxPolling();
  CURRENT_VIEW = view;

  ["dashboard", "inbox", "bugs", "tasks-list", "tasks-new", "workflows", "skills", "agents", "autopilots", "settings"].forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = view === v ? "" : "none";
  });

  const head = document.getElementById("pageHead");
  if (head) {
    head.classList.toggle("hidden", view === "tasks-new");
    head.classList.toggle("tasks-mode", view === "tasks-list");
    head.classList.toggle("dash-mode", view === "dashboard");
    head.classList.toggle("bugs-mode", view === "bugs");
    head.classList.toggle("inbox-mode", view === "inbox");
  }
  const main = document.querySelector(".main");
  if (main) main.classList.toggle("tasks-fill", view === "tasks-list");
  const inner = document.querySelector(".main-inner");
  if (inner) {
    inner.classList.toggle("tasks-wide", view === "tasks-list");
    inner.classList.toggle("tasks-session", view === "tasks-list");
    inner.classList.toggle("dash-wide", view === "dashboard");
    inner.classList.toggle("bugs-wide", view === "bugs");
    inner.classList.toggle("inbox-wide", view === "inbox");
    inner.classList.toggle("composer-wide", view === "tasks-new");
  }

  const navView = view === "tasks-new" ? "tasks-list" : view;
  document.querySelectorAll(".nav-item[data-view]").forEach((x) => {
    x.classList.toggle("active", x.dataset.view === navView);
  });

  const u = new URL(location.href);
  if (!view || view === "dashboard") u.searchParams.delete("view");
  else u.searchParams.set("view", view);
  if (view === "tasks-list") {
    if (opts.filter) u.searchParams.set("filter", opts.filter);
    else if (opts.resetFilter) u.searchParams.delete("filter");
  } else {
    u.searchParams.delete("filter");
  }

  if (view === "settings") {
    initSettingsUI();
  }
  const meta = VIEW_TITLES[view] || ["", ""];
  if (view !== "tasks-new") {
    document.getElementById("ptitle").textContent = meta[0];
    document.getElementById("psub").textContent = meta[1] || "";
  }
  syncPageTitle(view);
  if (view !== "settings") {
    if (view === "tasks-new") initTaskNewPage();
    if (view === "tasks-list") {
      setSessionPanelVisible(!!LOG_ID);
      const filterToApply = opts.filter
        || (!opts.resetFilter && u.searchParams.get("filter"))
        || "all";
      setTaskFilter(filterToApply, { syncUrl: false });
      if (filterToApply === "awaiting" && !opts.taskId) {
        document.getElementById("taskBoard")?.classList.remove("collapsed");
      }
      const openTaskId = (opts.taskId || "").trim();
      loadTasks().then(() => {
        if (openTaskId) showLog(openTaskId);
      });
      startTaskPolling();
    }
    if (view === "dashboard") {
      loadDashboard(true);
      startDashPolling();
    }
    if (view === "inbox") {
      loadInbox(true);
      startInboxPolling();
    }
    if (view === "bugs") loadBugs({ resetPage: false });
    if (view === "workflows") loadWorkflows();
    if (view === "skills") loadSkills();
    if (view === "agents") loadAgentsPage();
    if (view === "autopilots") loadAutopilotsPage();
  }

  history.replaceState(null, "", u.pathname + u.search);
}

document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
  el.addEventListener("click", () => {
    const v = el.dataset.view;
    if (v === "tasks-list") switchView(v, { resetFilter: true });
    else switchView(v);
  });
});

document.getElementById("wf-q").addEventListener("input", renderWorkflows);
const skQ = document.getElementById("sk-q");
if (skQ) skQ.addEventListener("input", renderSkills);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTaskPolling();
    stopDashPolling();
    stopInboxPolling();
    return;
  }
  if (CURRENT_VIEW === "tasks-list") startTaskPolling();
  if (CURRENT_VIEW === "dashboard") startDashPolling();
  if (CURRENT_VIEW === "inbox") startInboxPolling();
});

loadHealth();
initSettingsUI();
void refreshAgentProviderCache();
bindModalDismiss();
bindRawLogScroll();
bindRawDrawerResize();
bindFsListNav();

(function initDeepLink() {
  const logId = URL_PARAMS.get("log") || URL_PARAMS.get("task");
  const filter = (URL_PARAMS.get("filter") || "").trim();
  if (logId) {
    switchView("tasks-list", { filter: filter || undefined, taskId: logId });
    return;
  }
  const view = (URL_PARAMS.get("view") || "").trim();
  if (
    view &&
    ["dashboard", "inbox", "bugs", "workflows", "skills", "agents", "tasks-new", "tasks-list", "settings"].includes(view)
  ) {
    switchView(view, view === "tasks-list" && filter ? { filter } : undefined);
    return;
  }
  switchView("dashboard");
})();

/* Open Harness UI — hb-cli style, agent-desk API */
const TITLE_MAX = 80;
const PROMPT_MAX = 8000;
const TASK_PAGE_SIZE = 15;
const BOARD_PHASES = ["created", "preparing", "running", "awaiting"];
const URL_PARAMS = new URLSearchParams(location.search);
let DEEP_LINK_REPLY = (URL_PARAMS.get("reply") || "").trim();
let DEEP_LINK_REPLY_SENT = false;

let TASKS = [];
let TASK_FILTER = "all";
let TASK_PAGE = 1;
let TASK_POLL_TIMER = null;
let TASK_POLL_SIG = "";
const EXPANDED_TASK_GROUPS = new Set();

let WORKFLOW_LIST = [];
let WF_FILTER = "all";

let SKILL_LIST = [];
let SK_FILTER = "all";
let CURRENT_VIEW = "dashboard";
let DASH_POLL_TIMER = null;

let BUGS = [];
let BUG_PAGE = 1;
const BUG_PAGE_SIZE = 15;
let BUG_FILTER_KW = "";
/** @type {Map<string, object>} */
const ISSUE_CACHE = new Map();

let LOG_ID = null;
let LOG_TITLE = "";
let LOG_TIMER = null;
let LOG_CHOICES_KEY = "";

const STATUS_LABEL = {
  created: "待执行",
  running: "运行中",
  awaiting: "待确认",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

const ICON_PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#3b82f6"];

const VIEW_TITLES = {
  dashboard: ["总览看板", "基于本地任务与缺陷源的实时概览"],
  bugs: ["缺陷列表", "从 Issue Provider 拉取；支持 AI 修复并查看关联任务"],
  workflows: ["流程编排", "系统模板随安装包提供；创建任务时选择使用"],
  skills: ["技能", "内置随 CLI 同步更新；用户自建可卸载"],
  "tasks-new": ["新建任务", ""],
  "tasks-list": ["任务管理", ""],
  settings: ["通知与偏好设置", ""],
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
  return STATUS_LABEL[t.status] || t.status || "-";
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
      ].join(":"),
    )
    .sort()
    .join("|");
}

function hasActiveTasks(tasks) {
  return (tasks || []).some((t) => ["running", "awaiting", "created"].includes(t.status || ""));
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
  if (!text || !text.includes("hb-choices")) return null;
  const idx = text.indexOf("## hb-choices");
  if (idx < 0) return null;
  const section = text.slice(idx);
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

function canContinueTask(t) {
  if (!t) return false;
  const st = (t.status || "").trim();
  if (st !== "stopped" && st !== "failed" && st !== "awaiting") return false;
  return !!(tField(t, "sessionId", "session_id") || "").trim() || st === "awaiting" || st === "stopped" || st === "failed";
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
  renderTasks();
  if (showToast) toast(`已刷新 ${uiRootTasks().length} 条任务`);
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
    renderTasks();
    next.forEach((t) => {
      const was = prevStatus.get(t.id) || "";
      const now = t.status || "";
      if (now === "awaiting" && was === "running") {
        toast(`「${t.title || t.id}」等待确认，可点击「处理」`);
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
    if (LOG_ID) await pollLog();
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
  const canContinue = canContinueTask(t);
  const metaParts = [];
  if (proj) metaParts.push(proj);
  if (issue) metaParts.push(`<span class="bug-code">${issue}</span>`);
  metaParts.push(`活动 ${act}`);
  let ops = "";
  if (awaiting) {
    ops += `<button class="btn-install" data-act="log" data-id="${id}">处理</button>`;
    ops += `<button class="btn-stop" data-act="stop" data-id="${id}">停止</button>`;
  } else if (running) {
    ops += `<button class="btn-run" disabled>执行中…</button>`;
    ops += `<button class="btn-stop" data-act="stop" data-id="${id}">停止</button>`;
  } else if (canContinue) {
    ops += `<button class="btn-run" data-act="continue" data-id="${id}">继续</button>`;
  }
  ops += `<button class="btn-refresh" data-act="log" data-id="${id}">日志</button>`;
  if (!isChild) ops += `<button class="btn-uninstall" data-act="del" data-id="${id}">删除</button>`;
  const hasChildren = !!opts.hasChildren;
  const expanded = !!opts.expanded;
  const expandBtn = hasChildren
    ? `<button type="button" class="tr-expand${expanded ? " open" : ""}" data-act="toggle-group" data-id="${id}">▸</button>`
    : '<span class="tr-expand-spacer"></span>';
  const modeTag = !isChild && isSharedWorkflow(t)
    ? '<span class="tag tag-mode-shared">共享</span> '
    : !isChild && isIndependentWorkflow(t)
      ? '<span class="tag tag-mode-indep">独立</span> '
      : "";
  const tagClass = isChild ? "tag tag-step" : `tag tag-skill ${skill}`;
  const rowClass = `task-row${isChild ? " task-row-child" : hasChildren ? " task-row-parent" : ""}`;
  return (
    `<div class="${rowClass}">` +
    `<div class="tr-tag">${expandBtn}${modeTag}<span class="${tagClass}">${skillLabel}</span></div>` +
    `<div class="tr-main"><div class="tr-title" title="${title}">${title}</div>` +
    `<div class="tr-meta">${metaParts.join(" · ")}</div></div>` +
    `<div class="tr-status">${phaseLabel}</div>` +
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
      if (act === "toggle-group") {
        if (EXPANDED_TASK_GROUPS.has(id)) EXPANDED_TASK_GROUPS.delete(id);
        else EXPANDED_TASK_GROUPS.add(id);
        renderTasks();
        return;
      }
      if (act === "continue") continueTask(id);
      else if (act === "stop") stopTask(id);
      else if (act === "del") deleteTask(id);
      else if (act === "log") showLog(id);
    });
  });
  root.querySelectorAll(".kb-card").forEach((el) => {
    el.addEventListener("click", () => showLog(el.dataset.id));
  });
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
  } else {
    list.innerHTML = groups.map(renderTaskGroup).join("");
    renderTaskPager(total, TASK_PAGE, TASK_PAGE_SIZE);
  }
  bindTaskActs(document.getElementById("view-tasks-list"));
}

document.getElementById("taskFilters").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  TASK_FILTER = btn.dataset.filter || "all";
  TASK_PAGE = 1;
  document.querySelectorAll("#taskFilters .chip").forEach((c) => c.classList.toggle("active", c === btn));
  renderTasks();
});

document.getElementById("taskBoardToggle").addEventListener("click", () => {
  document.getElementById("taskBoard").classList.toggle("collapsed");
});

function renderLogTitle(status, title) {
  const name = (title || "").trim();
  const st = STATUS_LABEL[status] || status || "";
  if (name && st) return `执行日志 · ${name} · ${st}`;
  if (name) return `执行日志 · ${name}`;
  return "执行日志";
}

function setLogTitleEl(status, title) {
  const el = document.getElementById("logTitle");
  const name = (title || "").trim();
  el.textContent = renderLogTitle(status, name);
  el.title = name;
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

async function continueTask(id) {
  if (!id) return;
  try {
    await api(`/api/tasks/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      body: JSON.stringify({ reply: "继续" }),
    });
    toast("已继续本次会话");
    await loadTasks();
    showLog(id);
  } catch (e) {
    toast(`继续失败: ${e.message || e}`);
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

async function sendReply(preset) {
  if (!LOG_ID) return;
  const input = document.getElementById("replyInput");
  const reply = (preset || input.value || "").trim();
  if (!reply) return;
  input.value = "";
  try {
    await api(`/api/tasks/${encodeURIComponent(LOG_ID)}/resume`, {
      method: "POST",
      body: JSON.stringify({ reply }),
    });
    toast("已发送");
    await loadTasks();
    await pollLog();
  } catch (e) {
    toast(`发送失败: ${e.message || e}`);
  }
}

function onReplyKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendReply();
  }
}

async function pollLog() {
  if (!LOG_ID) return;
  try {
    const d = await api(`/api/tasks/${encodeURIComponent(LOG_ID)}`);
    const body = document.getElementById("logBody");
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 30;
    body.textContent = d.result || "(暂无输出)";
    if (atBottom) body.scrollTop = body.scrollHeight;
    setLogTitleEl(d.status, d.title || LOG_TITLE);
    if (d.title) LOG_TITLE = d.title;

    const running = d.status === "running";
    const stopBtn = document.getElementById("logStopBtn");
    if (stopBtn) stopBtn.style.display = running || d.status === "awaiting" ? "" : "none";

    const contBtn = document.getElementById("logContinueBtn");
    if (contBtn) contBtn.style.display = !running && canContinueTask(d) && d.status !== "awaiting" ? "" : "none";

    const rb = document.getElementById("replyBox");
    const canChat = !running && ["awaiting", "done", "failed", "stopped"].includes(d.status);
    rb.classList.toggle("show", canChat);

    const gate = d.status === "awaiting" ? parseGate(d.result || "") : null;
    const nextChoices = gate && gate.choices.length ? gate.choices : [];
    const nextKey = JSON.stringify(nextChoices);
    if (nextKey !== LOG_CHOICES_KEY) {
      LOG_CHOICES_KEY = nextKey;
      renderReplyChoices(nextChoices);
    }

    if (DEEP_LINK_REPLY && !DEEP_LINK_REPLY_SENT && d.status === "awaiting" && !running) {
      DEEP_LINK_REPLY_SENT = true;
      const autoReply = DEEP_LINK_REPLY;
      DEEP_LINK_REPLY = "";
      const u = new URL(location.href);
      u.searchParams.delete("reply");
      history.replaceState(null, "", u.pathname + u.search);
      setTimeout(() => sendReply(autoReply), 200);
    }

    if (running || d.status === "awaiting") {
      if (!LOG_TIMER) LOG_TIMER = setInterval(pollLog, 2000);
    } else if (LOG_TIMER) {
      clearInterval(LOG_TIMER);
      LOG_TIMER = null;
    }
  } catch (e) {
    document.getElementById("logBody").textContent = e.message || String(e);
  }
}

function showLog(id) {
  LOG_ID = id;
  LOG_TITLE = "";
  LOG_CHOICES_KEY = "";
  document.getElementById("logMask").classList.add("show");
  document.getElementById("replyInput").value = "";
  pollLog();
}

function closeLog() {
  document.getElementById("logMask").classList.remove("show");
  LOG_ID = null;
  if (LOG_TIMER) {
    clearInterval(LOG_TIMER);
    LOG_TIMER = null;
  }
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

async function fillSkillOptions() {
  const sel = document.getElementById("t-skill");
  if (!sel) return;
  const prev = sel.value || "default";
  const cwd = getTaskDir() || undefined;
  let rows = [];
  try {
    const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    rows = await api(`/api/skills${q}`);
  } catch {
    rows = [];
  }
  const opts = [{ id: "default", label: "default（无技能包）" }].concat(
    (Array.isArray(rows) ? rows : []).map((s) => ({
      id: s.id,
      label: s.description ? `${s.id} · ${s.description}` : `${s.id} (${s.source})`,
    })),
  );
  sel.innerHTML = opts
    .map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`)
    .join("");
  if (opts.some((o) => o.id === prev)) sel.value = prev;
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

function openWorkspacePicker(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const mask = document.getElementById("wsMask");
  const btn = document.getElementById("t-workspace-btn");
  if (!mask) return;
  mask.classList.add("show");
  if (btn) btn.setAttribute("aria-expanded", "true");
  setWsTab("browse");
  const start = getTaskDir() || "";
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
}

function onWsMaskClick(e) {
  if (e.target === e.currentTarget) closeWorkspacePicker();
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
      setTaskDir(p);
      clearTaskDirErr();
      closeWorkspacePicker();
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

function fsSelectCurrent() {
  if (!FS_BROWSER_PATH) return;
  setTaskDir(FS_BROWSER_PATH);
  clearTaskDirErr();
  closeWorkspacePicker();
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
  if (!document.body.dataset.wsEscBound) {
    document.body.dataset.wsEscBound = "1";
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isWorkspacePickerOpen()) {
        e.preventDefault();
        closeWorkspacePicker();
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
    const agentEl = document.getElementById("t-run-agent");
    if (agentEl) {
      const name = (s.codingAgent || "claude").trim();
      agentEl.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    }
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
      const run = await api(`/api/workflows/${encodeURIComponent(workflowId)}/run`, {
        method: "POST",
        body: JSON.stringify({ title, prompt, projectDir }),
      });
      pushRecentDir(projectDir);
      toast("流程已启动");
      switchView("tasks-list");
      if (run.parentTaskId) showLog(run.parentTaskId);
    } else {
      const skillEl = document.getElementById("t-skill");
      const skill = ((skillEl && skillEl.value) || "default").trim();
      const issueCode = (document.getElementById("t-issue-code")?.value || "").trim();
      const task = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: title || "Untitled",
          prompt,
          projectDir,
          skill,
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
  return `<div class="skill-item wf-item">
    <div class="sk-icon" style="background:${iconColor(w.id || w.name)}">${letter}</div>
    <div class="sk-info">
      <div class="n">${name}</div>
      <div class="d">${desc}</div>
      <div class="sk-ver">${meta}</div>
    </div>
    <div class="sk-right">
      <div class="sk-act" style="display:flex">
        <button class="btn-install" onclick="runWorkflow('${id}')">运行</button>
      </div>
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

async function loadWorkflows() {
  try {
    WORKFLOW_LIST = await api("/api/workflows");
    renderWorkflows();
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
  const projectDir = document.getElementById("t-dir")?.value?.trim() || undefined;
  try {
    const run = await api(`/api/workflows/${encodeURIComponent(id)}/run`, {
      method: "POST",
      body: JSON.stringify({ projectDir }),
    });
    toast("流程已启动");
    switchView("tasks-list");
    if (run.parentTaskId) showLog(run.parentTaskId);
  } catch (e) {
    toast(`启动失败: ${e.message || e}`);
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
  if (e.target === e.currentTarget) closeSkillDetail();
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
  fillSkillOptions().then(() => {
    const sel = document.getElementById("t-skill");
    if (sel) {
      const opt = [...sel.options].find((o) => o.value === id);
      if (!opt) {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = id;
        sel.appendChild(o);
      }
      sel.value = id;
    }
    toast(`已选择技能：${id}`);
  });
}

async function saveSettingsPatch(patch) {
  return api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(patch || {}),
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllSettingDropdowns();
  });
}

function mountSettingDropdown(root, options, current, onChange) {
  if (!root) return;
  const opts = Array.isArray(options) ? options : [];
  const value = current || (opts[0] && opts[0].id) || "";
  const currentOpt = opts.find((o) => o.id === value) || opts[0] || { id: value, displayName: value };
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
          `<span>${esc(o.displayName || o.id)}</span>${dropdownCheck()}</button>`
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

async function loadProviderOptions(endpoint, fallback) {
  try {
    const rows = await api(endpoint);
    if (Array.isArray(rows) && rows.length) return rows;
  } catch {
    /* ignore */
  }
  return fallback;
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
  const agentOpts = [{ id: "claude", displayName: "Claude Code" }];

  const saveSelect = async (key, nextVal) => {
    let patch;
    if (key === "providers.notify") patch = { providers: { notify: nextVal } };
    else if (key === "providers.issue") patch = { providers: { issue: nextVal } };
    else patch = { [key]: nextVal };
    const next = await saveSettingsPatch(patch);
    state = next;
  };

  mountSettingDropdown(
    document.getElementById("setNotifyProvider"),
    notifyOpts,
    (state.providers && state.providers.notify) || "webhook",
    async (nextVal) => {
      await saveSelect("providers.notify", nextVal);
      toast("已更新：通知通道");
    },
  );
  mountSettingDropdown(
    document.getElementById("setIssueProvider"),
    issueOpts,
    (state.providers && state.providers.issue) || "manual",
    async (nextVal) => {
      await saveSelect("providers.issue", nextVal);
      toast("已更新：缺陷来源");
    },
  );
  mountSettingDropdown(
    document.getElementById("setAgent"),
    agentOpts,
    state.codingAgent || "claude",
    async (nextVal) => {
      await saveSelect("codingAgent", nextVal);
      toast("已更新：默认编码 Agent");
    },
  );

  card.querySelectorAll(".setting-row").forEach((row) => {
    const key = row.dataset.key;
    if (!key) return;
    if (row.dataset.type === "select") return;

    if (row.dataset.type === "text") {
      const input = row.querySelector('input[type="text"]');
      if (!input) return;
      input.value = state[key] || "";
      const commit = async () => {
        const prev = state[key] || "";
        const nextVal = (input.value || "").trim();
        if (nextVal === prev) return;
        try {
          const next = await saveSettingsPatch({ [key]: nextVal });
          state = next;
          input.value = next[key] || "";
          toast(`已更新：${settingsLabel(row, key)}`);
        } catch (e) {
          input.value = prev;
          toast(`保存失败: ${e.message || e}`);
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
    "<p style=\"margin-top:16px;font-size:12px;color:#9aa0a6\">下次使用请重新执行 <code>oh web</code></p>" +
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
  if (CURRENT_VIEW === "bugs") return loadBugs({ resetPage: false });
  if (CURRENT_VIEW === "tasks-list") return loadTasks(true);
  if (CURRENT_VIEW === "workflows") return loadWorkflows();
  if (CURRENT_VIEW === "skills") return loadSkills();
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
    <button type="button" class="btn-outline" onclick="showLog('${id}')">${esc(actionLabel)}</button>
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
  const taskId = related ? esc(related.id) : "";
  const busy =
    related && ["running", "awaiting", "created", "preparing"].includes(String(related.status || ""));
  let ops = "";
  if (busy) {
    ops =
      `<button type="button" class="btn-outline" disabled title="已有关联任务进行中">AI 修复</button>` +
      `<button type="button" class="btn-outline" onclick="openIssueTask('${taskId}')">查看任务</button>`;
  } else {
    ops = `<button type="button" class="btn-outline" onclick="startTaskFromIssue('${codeAttr}')">AI 修复</button>`;
    if (related) {
      ops += `<button type="button" class="btn-outline" onclick="openIssueTask('${taskId}')">查看任务</button>`;
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
    ["running", "awaiting", "created", "preparing"].includes(String(t.status || "")),
  );
  if (busy) return busy;
  return rows
    .slice()
    .sort(
      (a, b) =>
        Number(b.lastActivityAt || b.updatedAt || 0) - Number(a.lastActivityAt || a.updatedAt || 0),
    )[0];
}

function openIssueTask(taskId) {
  if (!taskId) return;
  switchView("tasks-list");
  loadTasks().then(() => showLog(taskId));
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
      const related = relatedTaskForIssue(b.code);
      const busy = related && ["running", "awaiting", "created", "preparing"].includes(String(related.status || ""));
      let ops = `<span class="bug-ops">`;
      if (busy) {
        ops +=
          `<button type="button" class="btn-fix" disabled title="已有关联任务进行中">AI 修复</button>` +
          `<button type="button" class="btn-task" data-task="${esc(related.id)}">查看任务</button>`;
      } else {
        ops += `<button type="button" class="btn-fix" data-code="${codeAttr}">AI 修复</button>`;
        if (related) {
          ops += `<button type="button" class="btn-task" data-task="${esc(related.id)}">查看任务</button>`;
        }
      }
      ops += `</span>`;
      const relatedCell = related
        ? `<span class="bug-code" title="${esc(related.title || related.id)}">${esc(STATUS_LABEL[related.status] || related.status)}</span>`
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
    "<th>编号</th><th>状态</th><th>严重程度</th><th>标题</th><th>关联任务</th><th>更新</th><th>操作</th>" +
    `</tr></thead><tbody>${rows}</tbody></table>`;
  renderBugPager(list.length, BUG_PAGE, BUG_PAGE_SIZE);
  box.querySelectorAll(".btn-fix").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      startTaskFromIssue(btn.dataset.code);
    });
  });
  box.querySelectorAll(".btn-task[data-task]").forEach((btn) => {
    btn.addEventListener("click", () => openIssueTask(btn.dataset.task));
  });
}

async function loadBugs(opts = {}) {
  const box = document.getElementById("bug-list");
  if (!box) return;
  if (opts.resetPage) BUG_PAGE = 1;
  const qEl = document.getElementById("bug-q");
  const stateEl = document.getElementById("bug-state");
  BUG_FILTER_KW = ((qEl && qEl.value) || "").trim().toLowerCase();
  const state = ((stateEl && stateEl.value) || "open").trim();
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
  if (issue.projectDir) {
    const dirEl = document.getElementById("t-dir");
    if (dirEl) dirEl.value = issue.projectDir;
    syncWorkspaceLabel();
  }
  fillSkillOptions().then(() => {
    const sel = document.getElementById("t-skill");
    if (!sel) return;
    const prefer = ["fix", "bug-fix", "triage"];
    for (const id of prefer) {
      if ([...sel.options].some((o) => o.value === id)) {
        sel.value = id;
        break;
      }
    }
  });
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
    setNum("dash-awaiting", d.awaiting_count);
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
    awaitingBox.innerHTML = awaiting.length
      ? awaiting.map((t) => renderDashTaskItem(t, "处理")).join("")
      : '<div class="dash-empty">暂无待确认事项</div>';
  } catch (e) {
    awaitingBox.innerHTML = `<div class="dash-empty">加载失败: ${esc(e.message || e)}</div>`;
    issuesBox.innerHTML = "";
  }
}

function switchView(view) {
  if (view !== "tasks-list" && document.getElementById("logMask").classList.contains("show")) closeLog();
  if (view !== "tasks-list") stopTaskPolling();
  if (view !== "dashboard") stopDashPolling();
  CURRENT_VIEW = view;

  ["dashboard", "bugs", "tasks-list", "tasks-new", "workflows", "skills", "settings"].forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = view === v ? "" : "none";
  });

  const head = document.getElementById("pageHead");
  if (head) {
    head.classList.toggle("hidden", view === "settings" || view === "tasks-new");
    head.classList.toggle("tasks-mode", view === "tasks-list");
    head.classList.toggle("dash-mode", view === "dashboard");
    head.classList.toggle("bugs-mode", view === "bugs");
  }
  const inner = document.querySelector(".main-inner");
  if (inner) {
    inner.classList.toggle("tasks-wide", view === "tasks-list");
    inner.classList.toggle("dash-wide", view === "dashboard");
    inner.classList.toggle("bugs-wide", view === "bugs");
    inner.classList.toggle("composer-wide", view === "tasks-new");
  }

  const navView = view === "tasks-new" ? "tasks-list" : view;
  document.querySelectorAll(".nav-item[data-view]").forEach((x) => {
    x.classList.toggle("active", x.dataset.view === navView);
  });

  if (view === "settings") {
    initSettingsUI();
  } else {
    const meta = VIEW_TITLES[view] || ["", ""];
    document.getElementById("ptitle").textContent = meta[0];
    document.getElementById("psub").textContent = meta[1] || "";
    if (view === "tasks-new") initTaskNewPage();
    if (view === "tasks-list") {
      loadTasks();
      startTaskPolling();
    }
    if (view === "dashboard") {
      loadDashboard(true);
      startDashPolling();
    }
    if (view === "bugs") loadBugs({ resetPage: false });
    if (view === "workflows") loadWorkflows();
    if (view === "skills") loadSkills();
  }

  const u = new URL(location.href);
  if (!view || view === "dashboard") u.searchParams.delete("view");
  else u.searchParams.set("view", view);
  history.replaceState(null, "", u.pathname + u.search);
}

document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
  el.addEventListener("click", () => switchView(el.dataset.view));
});

document.getElementById("wf-q").addEventListener("input", renderWorkflows);
const skQ = document.getElementById("sk-q");
if (skQ) skQ.addEventListener("input", renderSkills);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTaskPolling();
    stopDashPolling();
    return;
  }
  if (CURRENT_VIEW === "tasks-list") startTaskPolling();
  if (CURRENT_VIEW === "dashboard") startDashPolling();
});

loadHealth();
initSettingsUI();

(function initDeepLink() {
  const logId = URL_PARAMS.get("log") || URL_PARAMS.get("task");
  if (logId) {
    switchView("tasks-list");
    loadTasks().then(() => showLog(logId));
    return;
  }
  const view = (URL_PARAMS.get("view") || "").trim();
  if (
    view &&
    ["dashboard", "bugs", "workflows", "skills", "tasks-new", "tasks-list", "settings"].includes(view)
  ) {
    switchView(view);
    return;
  }
  switchView("dashboard");
})();

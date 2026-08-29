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
  workflows: ["流程编排", "系统模板随安装包提供；创建任务时选择使用"],
  "tasks-new": ["新建任务", ""],
  "tasks-list": ["任务管理", ""],
  settings: ["通知与偏好设置", ""],
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
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
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
  if (wfWrap) wfWrap.style.display = t === "workflow" ? "" : "none";
  if (t === "workflow") fillWorkflowOptions();
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

function setTaskDir(dirPath) {
  const val = (dirPath || "").trim();
  const hidden = document.getElementById("t-dir");
  if (hidden) hidden.value = val;
  syncWorkspaceLabel();
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
      const task = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: title || "Untitled", prompt, projectDir }),
      });
      pushRecentDir(projectDir);
      toast("任务已创建");
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

function switchView(view) {
  if (view !== "tasks-list" && document.getElementById("logMask").classList.contains("show")) closeLog();
  if (view !== "tasks-list") stopTaskPolling();

  ["tasks-list", "tasks-new", "workflows", "settings"].forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = view === v ? "" : "none";
  });

  const head = document.getElementById("pageHead");
  if (head) {
    head.classList.toggle("hidden", view === "settings" || view === "tasks-new");
    head.classList.toggle("tasks-mode", view === "tasks-list");
  }
  const inner = document.querySelector(".main-inner");
  if (inner) {
    inner.classList.toggle("tasks-wide", view === "tasks-list");
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
    if (view === "workflows") loadWorkflows();
  }

  const u = new URL(location.href);
  if (!view || view === "tasks-list") u.searchParams.delete("view");
  else u.searchParams.set("view", view);
  history.replaceState(null, "", u.pathname + u.search);
}

document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
  el.addEventListener("click", () => switchView(el.dataset.view));
});

document.getElementById("wf-q").addEventListener("input", renderWorkflows);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopTaskPolling();
    return;
  }
  const listView = document.getElementById("view-tasks-list");
  if (listView && listView.style.display !== "none") startTaskPolling();
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
  if (view && ["workflows", "tasks-new", "tasks-list", "settings"].includes(view)) {
    switchView(view);
    return;
  }
  switchView("tasks-list");
})();

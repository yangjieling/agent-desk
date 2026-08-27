const TITLE_MAX = 80;
const PROMPT_MAX = 8000;
const POLL_MS = 2000;

let currentView = "tasks";
let selectedTaskId = null;
let pollTimer = null;
let creating = false;

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || err.message || res.statusText);
  }
  return res.json();
}

function statusBadge(status) {
  const s = status || "created";
  return `<span class="badge ${s}">${s}</span>`;
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view || (view === "task-detail" && el.dataset.view === "tasks"));
  });
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  if (view === "task-detail") {
    $("view-task-detail").classList.remove("hidden");
  } else {
    const map = { tasks: "view-tasks", workflows: "view-workflows", "new-task": "view-new-task", settings: "view-settings" };
    $(map[view] || "view-tasks").classList.remove("hidden");
  }
  const titles = {
    tasks: ["任务", "查看与管理 Agent 任务"],
    "task-detail": ["任务详情", "闸门确认与输出"],
    workflows: ["流程", "Workflow 模板与运行实例"],
    "new-task": ["新建", "创建单技能或流程任务"],
    settings: ["设置", "通知与 Agent 配置"],
  };
  const [t, sub] = titles[view] || titles.tasks;
  $("pageTitle").textContent = t;
  $("pageSub").textContent = sub;
}

function parseGate(text) {
  if (!text || !text.includes("hb-choices")) return null;
  const idx = text.indexOf("## hb-choices");
  if (idx < 0) return null;
  const section = text.slice(idx);
  const headingMatch = text.match(/##\s*闸门[「"']([^」"']+)[」"']/);
  const choices = [];
  for (const line of section.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("-")) continue;
    const raw = t.slice(1).trim();
    const sep = raw.includes("|") ? "|" : raw.includes("｜") ? "｜" : null;
    if (sep) {
      const [label, value] = raw.split(sep).map((s) => s.trim());
      if (label && value) choices.push({ label, value });
    } else if (raw) choices.push({ label: raw, value: raw });
  }
  return { heading: headingMatch ? `闸门「${headingMatch[1]}」` : "闸门", choices };
}

async function loadHealth() {
  try {
    const h = await api("/api/health");
    $("ver").textContent = h.version ? `v${h.version}` : "";
  } catch {
    $("ver").textContent = "";
  }
}

async function loadTasks() {
  const tasks = await api("/api/tasks");
  const el = $("taskList");
  if (!tasks.length) {
    el.innerHTML = '<div class="empty">暂无任务</div>';
    return;
  }
  el.innerHTML = tasks
    .map(
      (t) => `
    <div class="card task-row" data-id="${t.id}">
      <div>
        <div class="task-title">${escapeHtml(t.title || t.id)}</div>
        <div class="task-meta">${escapeHtml(t.id)} · ${t.taskType}${t.workflowName ? ` · ${escapeHtml(t.workflowName)}` : ""}${t.workflowStepTotal ? ` · ${t.workflowStep}/${t.workflowStepTotal}` : ""}</div>
      </div>
      ${statusBadge(t.status)}
    </div>`,
    )
    .join("");
  el.querySelectorAll(".task-row").forEach((row) => {
    row.onclick = () => openTask(row.dataset.id);
  });
}

async function openTask(id) {
  selectedTaskId = id;
  switchView("task-detail");
  await refreshTaskDetail();
  startPoll();
}

async function refreshTaskDetail() {
  if (!selectedTaskId) return;
  const t = await api(`/api/tasks/${selectedTaskId}`);
  $("detailTitle").textContent = t.title || t.id;
  const badge = $("detailStatus");
  badge.textContent = t.status;
  badge.className = `badge ${t.status}`;
  $("detailMeta").textContent = [
    t.id,
    t.taskType,
    t.workflowName && `流程: ${t.workflowName}`,
    t.workflowStepTotal && `步骤 ${t.workflowStep}/${t.workflowStepTotal}`,
    t.projectDir && `目录: ${t.projectDir}`,
  ]
    .filter(Boolean)
    .join(" · ");
  $("detailOutput").textContent = t.result || "(无输出)";

  const actions = $("detailActions");
  actions.innerHTML = "";
  if (["running", "awaiting", "created"].includes(t.status)) {
    actions.appendChild(btn("停止", "danger", () => taskAction("stop")));
  }
  if (["stopped", "failed", "awaiting"].includes(t.status)) {
    actions.appendChild(btn("继续", "primary", () => taskAction("resume", "继续")));
  }
  if (t.status === "awaiting" && t.workflowRunId) {
    actions.appendChild(btn("推进流程", "secondary", () => workflowContinue(t.workflowRunId)));
  }

  await renderWorkflowSteps(t);

  const gate = t.status === "awaiting" ? parseGate(t.result) : null;
  const panel = $("gatePanel");
  if (gate && gate.choices.length) {
    panel.classList.remove("hidden");
    $("gateHeading").textContent = gate.heading;
    $("gateChoices").innerHTML = gate.choices
      .map((c) => `<button class="btn gate-choice" data-value="${escapeAttr(c.value)}">${escapeHtml(c.label)}</button>`)
      .join("");
    $("gateChoices").querySelectorAll(".gate-choice").forEach((b) => {
      b.onclick = () => taskAction("resume", b.dataset.value);
    });
  } else {
    panel.classList.add("hidden");
  }
}

function btn(label, cls, onClick) {
  const b = document.createElement("button");
  b.className = `btn ${cls}`;
  b.textContent = label;
  b.type = "button";
  b.onclick = onClick;
  return b;
}

async function taskAction(action, reply) {
  if (!selectedTaskId) return;
  if (action === "stop") await api(`/api/tasks/${selectedTaskId}/stop`, { method: "POST" });
  if (action === "resume") await api(`/api/tasks/${selectedTaskId}/resume`, { method: "POST", body: JSON.stringify({ reply: reply || "继续" }) });
  await refreshTaskDetail();
  await loadTasks();
}

async function renderWorkflowSteps(task) {
  const panel = $("wfStepsPanel");
  const list = $("wfSteps");
  if (!task.workflowRunId) {
    panel.classList.add("hidden");
    return;
  }
  try {
    const run = await api(`/api/workflow-runs/${task.workflowRunId}`);
    panel.classList.remove("hidden");
    list.innerHTML = run.nodes
      .map((n, i) => {
        const cls =
          n.status === "done" || n.status === "skipped"
            ? "done"
            : i === run.currentIndex && ["running", "awaiting"].includes(run.status)
              ? "active"
              : "";
        return `<li class="${cls}">${escapeHtml(n.title || n.skill)} <span class="badge ${n.status}">${n.status}</span></li>`;
      })
      .join("");
  } catch {
    panel.classList.add("hidden");
  }
}

async function workflowContinue(runId) {
  await api(`/api/workflow-runs/${runId}/continue`, { method: "POST" });
  await refreshTaskDetail();
}

async function loadWorkflows() {
  const [templates, runs] = await Promise.all([api("/api/workflows"), api("/api/workflow-runs")]);
  const el = $("workflowList");
  let html = "<h3 style='margin:0 0 12px;font-size:14px;color:var(--muted)'>模板</h3>";
  if (!templates.length) html += '<div class="empty">无模板</div>';
  else {
    html += templates
      .map(
        (w) => `
      <div class="card wf-row">
        <div>
          <div class="task-title">${escapeHtml(w.name)}</div>
          <div class="task-meta">${escapeHtml(w.id)} · ${w.mode} · ${w.nodes.length} 步 · ${w.source || "system"}</div>
        </div>
        <button class="btn primary" data-wf="${escapeAttr(w.id)}">运行</button>
      </div>`,
      )
      .join("");
  }
  html += "<h3 style='margin:24px 0 12px;font-size:14px;color:var(--muted)'>运行实例</h3>";
  if (!runs.length) html += '<div class="empty">暂无运行</div>';
  else {
    html += runs
      .map(
        (r) => `
      <div class="card wf-row" data-run="${escapeAttr(r.id)}">
        <div>
          <div class="task-title">${escapeHtml(r.workflowName)}</div>
          <div class="task-meta">${escapeHtml(r.id)} · ${r.mode} · 步 ${r.currentIndex + 1}/${r.nodes.length}</div>
        </div>
        ${statusBadge(r.status)}
      </div>`,
      )
      .join("");
  }
  el.innerHTML = html;
  el.querySelectorAll("[data-wf]").forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      runWorkflowQuick(b.dataset.wf);
    };
  });
  el.querySelectorAll("[data-run]").forEach((row) => {
    row.onclick = async () => {
      const run = await api(`/api/workflow-runs/${row.dataset.run}`);
      if (run.parentTaskId) openTask(run.parentTaskId);
    };
  });

  const sel = $("formWorkflow");
  sel.innerHTML = templates.map((w) => `<option value="${escapeAttr(w.id)}">${escapeHtml(w.name)} (${w.mode})</option>`).join("");
}

async function runWorkflowQuick(workflowId) {
  const projectDir = $("formDir").value.trim() || undefined;
  const prompt = "";
  const run = await api(`/api/workflows/${workflowId}/run`, {
    method: "POST",
    body: JSON.stringify({ projectDir, prompt }),
  });
  if (run.parentTaskId) openTask(run.parentTaskId);
  else await loadWorkflows();
}

async function createTask() {
  if (creating) return;
  const type = $("formType").value;
  const title = $("formTitle").value.trim();
  const prompt = $("formPrompt").value.trim();
  const projectDir = $("formDir").value.trim() || undefined;
  if (title.length > TITLE_MAX) return hint(`标题最多 ${TITLE_MAX} 字`);
  if (prompt.length > PROMPT_MAX) return hint(`Prompt 最多 ${PROMPT_MAX} 字`);

  creating = true;
  $("btnCreate").disabled = true;
  hint("创建中…");
  try {
    if (type === "workflow") {
      const workflowId = $("formWorkflow").value;
      if (!workflowId) throw new Error("请选择流程");
      const run = await api(`/api/workflows/${workflowId}/run`, {
        method: "POST",
        body: JSON.stringify({ title, prompt, projectDir }),
      });
      hint("");
      openTask(run.parentTaskId);
    } else {
      if (!prompt) throw new Error("请填写 Prompt");
      const task = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ title: title || "Untitled", prompt, projectDir }),
      });
      hint("");
      openTask(task.id);
    }
  } catch (e) {
    hint(e.message || String(e));
  } finally {
    creating = false;
    $("btnCreate").disabled = false;
  }
}

function hint(msg) {
  $("formHint").textContent = msg;
}

async function loadSettings() {
  const s = await api("/api/settings");
  $("setNotify").checked = !!s.notifyEnabled;
  $("setAutoGate").checked = !!s.autoConfirmGates;
  $("setWebUrl").value = s.webBaseUrl || "";
  $("setAgent").value = s.codingAgent || "";
}

async function saveSettings() {
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      notifyEnabled: $("setNotify").checked,
      autoConfirmGates: $("setAutoGate").checked,
      webBaseUrl: $("setWebUrl").value.trim(),
    }),
  });
  hint("已保存");
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(async () => {
    if (currentView === "task-detail" && selectedTaskId) await refreshTaskDetail();
    if (currentView === "tasks") await loadTasks();
  }, POLL_MS);
}
function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

document.querySelectorAll(".nav-item").forEach((el) => {
  el.onclick = () => {
    selectedTaskId = null;
    stopPoll();
    switchView(el.dataset.view);
    if (el.dataset.view === "tasks") loadTasks().then(startPoll);
    if (el.dataset.view === "workflows") loadWorkflows();
    if (el.dataset.view === "new-task") loadWorkflows();
    if (el.dataset.view === "settings") loadSettings();
  };
});

$("btnRefresh").onclick = async () => {
  if (currentView === "tasks") await loadTasks();
  if (currentView === "task-detail") await refreshTaskDetail();
  if (currentView === "workflows") await loadWorkflows();
};

$("formType").onchange = () => {
  $("formWorkflowWrap").classList.toggle("hidden", $("formType").value !== "workflow");
};

$("btnCreate").onclick = createTask;
$("btnSaveSettings").onclick = saveSettings;

const params = new URLSearchParams(location.search);
const taskParam = params.get("task");
loadHealth().then(() => {
  if (taskParam) openTask(taskParam);
  else {
    switchView("tasks");
    loadTasks().then(startPoll);
  }
});

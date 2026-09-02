export type TaskStatus =
  | "created"
  | "queued"
  | "running"
  | "awaiting"
  | "done"
  | "failed"
  | "stopped";

export type TaskFailureCode =
  | ""
  | "workspace_busy"
  | "spawn_error"
  | "exit_nonzero"
  | "backend_unavailable"
  | "start_error";

export type TaskType = "skill" | "workflow";

export type WorkflowMode = "shared" | "independent";

export interface AgentProfile {
  id: string;
  name: string;
  /** Provider id: claude, codex, cursor, … */
  provider: string;
  model: string;
  defaultSkill: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}

export type WorkItemStatus = "open" | "in_progress" | "in_review" | "done" | "cancelled";

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  projectDir: string;
  /** Issue provider id when linked to external issue (manual, github, …). */
  issueProvider: string;
  /** External issue code, e.g. #42. Empty for ad-hoc local work items. */
  issueCode: string;
  agentProfileId: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

/** Shared memory on a work item (gate decisions, notes, run linkage). */
export type WorkItemEventKind = "note" | "gate_reply" | "run_linked" | "system";

export interface WorkItemEvent {
  id: string;
  workItemId: string;
  kind: WorkItemEventKind;
  /** user | agent | system */
  author: string;
  body: string;
  /** Optional linked task id for gate / run events. */
  taskId: string;
  createdAt: number;
}

/** Local Autopilot rule (cron → skill task or workflow). */
export type AutopilotStatus = "active" | "paused" | "archived";
export type AutopilotAction = "skill_task" | "workflow_run";
/** create_work_item ≈ Multica create_issue; run_only ≈ Multica run_only. */
export type AutopilotExecutionMode = "run_only" | "create_work_item";
export type AutopilotConcurrencyPolicy = "skip" | "allow";
export type AutopilotRunSource = "schedule" | "manual";
export type AutopilotRunStatus = "pending" | "running" | "skipped" | "completed" | "failed";

export interface Autopilot {
  id: string;
  name: string;
  /** Runbook / prompt body passed to the task or workflow. */
  runbook: string;
  status: AutopilotStatus;
  action: AutopilotAction;
  executionMode: AutopilotExecutionMode;
  skill: string;
  workflowId: string;
  projectDir: string;
  agentProfileId: string;
  model: string;
  titleTemplate: string;
  /** Standard 5-field cron: minute hour day-of-month month day-of-week. */
  cronExpression: string;
  timezone: string;
  nextRunAt: number;
  lastRunAt: number;
  concurrencyPolicy: AutopilotConcurrencyPolicy;
  createdAt: number;
  updatedAt: number;
}

export interface AutopilotRun {
  id: string;
  autopilotId: string;
  source: AutopilotRunSource;
  status: AutopilotRunStatus;
  taskId: string;
  workflowRunId: string;
  workItemId: string;
  /** Cron slot timestamp for schedule idempotency; 0 for manual. */
  plannedAt: number;
  triggeredAt: number;
  completedAt: number;
  failureReason: string;
  createdAt: number;
}

export interface Task {
  id: string;
  taskType: TaskType;
  status: TaskStatus;
  skill: string;
  workflowId: string;
  workflowRunId: string;
  workflowName: string;
  workflowMode: WorkflowMode | "";
  workflowStep: number;
  workflowStepTotal: number;
  parentTaskId: string;
  workflowNodeIndex: number | null;
  projectDir: string;
  /** Local work item this execution belongs to. */
  workItemId: string;
  issueCode: string;
  title: string;
  prompt: string;
  /** Named agent profile; empty = follow settings.defaultAgentId / codingAgent */
  agentProfileId: string;
  codingAgent: string;
  model: string;
  sessionId: string;
  result: string;
  gateNotifyHash: string;
  /** Completed auto-retry attempts (not including the first run). */
  retryCount: number;
  failureCode: TaskFailureCode;
  failureMessage: string;
  /** When > 0, queued task should not start before this timestamp. */
  nextRetryAt: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface WorkflowNode {
  id: string;
  skill: string;
  title: string;
  prompt: string;
  /** Optional agent profile for this step; empty = inherit workflow / task default */
  agentProfileId?: string;
  /** When true, step prompt insists on emitting a human gate before finishing. */
  requireGate?: boolean;
  /** On step failure: stop run, skip to next step, or retry the step. */
  onFailure?: "stop" | "continue" | "retry";
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  mode: WorkflowMode;
  source?: "system" | "user";
  nodes: WorkflowNode[];
  createdAt?: number;
  updatedAt?: number;
}

export interface GateChoice {
  label: string;
  value: string;
}

export interface ParsedGate {
  name: string;
  heading: string;
  choices: GateChoice[];
}

export interface Settings {
  notifyEnabled: boolean;
  autoConfirmGates: boolean;
  /** Default named agent profile for new tasks. */
  defaultAgentId: string;
  codingAgent: string;
  /** Default LLM model for new tasks; empty = follow CLI default. */
  defaultModel: string;
  /** When true, only one active task per project directory at a time. */
  workspaceLockEnabled: boolean;
  /** Auto-retry failed tasks up to maxRetries with retryDelaySec between attempts. */
  autoRetryEnabled: boolean;
  maxRetries: number;
  retryDelaySec: number;
  /** When workspace is busy, queue the task instead of failing immediately. */
  queueWhenWorkspaceBusy: boolean;
  idleTimeoutSec: number;
  awaitingIdleTimeoutSec: number;
  webBaseUrl: string;
  /** Workflow id used by bugs「AI 修复」; empty / "none" = single skill task. */
  defaultFixWorkflowId: string;
  /** Default mode when creating a user workflow template. */
  defaultWorkflowMode: WorkflowMode;
  providers: {
    agent: string;
    issue: string;
    notify: string;
  };
  /**
   * DingTalk credentials stored under ~/.agent-desk (SQLite settings).
   * Environment variables AD_DINGTALK_* still override when set.
   */
  dingtalk: DingTalkSettings;
  /**
   * GitHub Issues credentials stored under ~/.agent-desk (SQLite settings).
   * Environment variables AD_GITHUB_* still override when set.
   */
  github: GitHubSettings;
  /**
   * Generic HTTP webhook notify URL stored under ~/.agent-desk.
   * Environment variable AD_NOTIFY_WEBHOOK_URL still overrides when set.
   */
  notifyWebhook: NotifyWebhookSettings;
}

/** Persisted generic webhook notify settings. */
export interface NotifyWebhookSettings {
  url: string;
}

export const DEFAULT_NOTIFY_WEBHOOK_SETTINGS: NotifyWebhookSettings = {
  url: "",
};

/** Persisted DingTalk notify / interactive-card settings (no env required). */
export interface DingTalkSettings {
  webhook: string;
  secret: string;
  keyword: string;
  appKey: string;
  appSecret: string;
  agentId: string;
  userIds: string;
  cardTemplateId: string;
}

export const DEFAULT_DINGTALK_SETTINGS: DingTalkSettings = {
  webhook: "",
  secret: "",
  keyword: "",
  appKey: "",
  appSecret: "",
  agentId: "",
  userIds: "",
  cardTemplateId: "",
};

/** Persisted GitHub issue provider settings (no env required). */
export interface GitHubSettings {
  token: string;
  /** owner/repo, e.g. "acme/app" */
  repo: string;
  owner: string;
  repoName: string;
  projectDir: string;
  apiBase: string;
}

export const DEFAULT_GITHUB_SETTINGS: GitHubSettings = {
  token: "",
  repo: "",
  owner: "",
  repoName: "",
  projectDir: "",
  apiBase: "",
};

export const DEFAULT_SETTINGS: Settings = {
  notifyEnabled: true,
  autoConfirmGates: false,
  defaultAgentId: "",
  codingAgent: "claude",
  defaultModel: "",
  workspaceLockEnabled: true,
  autoRetryEnabled: true,
  maxRetries: 2,
  retryDelaySec: 30,
  queueWhenWorkspaceBusy: true,
  idleTimeoutSec: 3600,
  awaitingIdleTimeoutSec: 86400,
  webBaseUrl: "http://127.0.0.1:19877",
  defaultFixWorkflowId: "sys-fix-pipeline",
  defaultWorkflowMode: "shared",
  providers: {
    agent: "claude",
    issue: "manual",
    notify: "webhook",
  },
  dingtalk: { ...DEFAULT_DINGTALK_SETTINGS },
  github: { ...DEFAULT_GITHUB_SETTINGS },
  notifyWebhook: { ...DEFAULT_NOTIFY_WEBHOOK_SETTINGS },
};

export const TITLE_MAX_LEN = 80;
export const PROMPT_MAX_LEN = 8000;

export const DEFAULT_ABORT_REPLIES = new Set([
  "skip",
  "cancel",
  "先不修",
  "暂不修",
  "不修了",
  "不处理",
]);

export type WorkflowRunStatus =
  | "pending"
  | "running"
  | "awaiting"
  | "done"
  | "failed"
  | "stopped";

export type WorkflowRunNodeStatus =
  | "pending"
  | "running"
  | "queued"
  | "awaiting"
  | "done"
  | "failed"
  | "skipped"
  | "stopped";

export interface WorkflowRunNode {
  nodeId: string;
  skill: string;
  title: string;
  prompt: string;
  taskId: string;
  status: WorkflowRunNodeStatus;
  result?: string;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  mode: WorkflowMode;
  projectDir: string;
  inputPrompt: string;
  issueCode: string;
  parentTaskId: string;
  status: WorkflowRunStatus;
  currentIndex: number;
  sharedContext: string;
  awaitingTaskId: string;
  nodes: WorkflowRunNode[];
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | "created"
  | "running"
  | "awaiting"
  | "done"
  | "failed"
  | "stopped";

export type TaskType = "skill" | "workflow";

export type WorkflowMode = "shared" | "independent";

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
  issueCode: string;
  title: string;
  prompt: string;
  codingAgent: string;
  sessionId: string;
  result: string;
  gateNotifyHash: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface WorkflowNode {
  id: string;
  skill: string;
  title: string;
  prompt: string;
  /** When true, step prompt insists on emitting a human gate before finishing. */
  requireGate?: boolean;
  /** v1: only "stop" is honored by the engine; others are reserved. */
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
  codingAgent: string;
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
}

export const DEFAULT_SETTINGS: Settings = {
  notifyEnabled: true,
  autoConfirmGates: false,
  codingAgent: "claude",
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

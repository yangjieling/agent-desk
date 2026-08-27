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
  webBaseUrl: "http://127.0.0.1:19876",
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

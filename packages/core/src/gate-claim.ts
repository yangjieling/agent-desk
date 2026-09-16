/** One-shot gate consumption: pendingGateId issue + cross-channel claim. */

import { randomBytes } from "node:crypto";

export type GateClaimCode =
  | "invalid"
  | "busy"
  | "missing"
  | "duplicate"
  | "missing_gate"
  | "stale";

export type GateClaimOk = {
  ok: true;
  claimed: boolean;
  gateId: string;
  legacy?: boolean;
  /** Caller should clear task.pendingGateId in DB when true. */
  clearPending: boolean;
};

export type GateClaimErr = {
  ok: false;
  error: string;
  code: GateClaimCode;
};

export type GateClaimResult = GateClaimOk | GateClaimErr;

const claimedAwaiting = new Set<string>();

export function newGateId(): string {
  return randomBytes(8).toString("hex");
}

export function clearGateClaimState(taskId: string): void {
  const tid = (taskId || "").trim();
  if (!tid) return;
  claimedAwaiting.delete(tid);
}

export function isGateClaimHeld(taskId: string): boolean {
  return claimedAwaiting.has((taskId || "").trim());
}

/**
 * Evaluate whether this reply may consume the current awaiting gate.
 * Pure regarding DB; mutates in-process claim set on success for awaiting.
 */
export function claimPendingGate(input: {
  taskId: string;
  status: string;
  pendingGateId: string;
  gateId?: string;
  isRunning: boolean;
}): GateClaimResult {
  const tid = (input.taskId || "").trim();
  if (!tid) {
    return { ok: false, error: "缺少任务 id", code: "invalid" };
  }
  const req = (input.gateId || "").trim();
  const pending = (input.pendingGateId || "").trim();
  const status = (input.status || "").trim();

  if (input.isRunning) {
    return {
      ok: false,
      error: "任务正在执行中，请勿重复触发。",
      code: "busy",
    };
  }

  if (status === "awaiting") {
    if (claimedAwaiting.has(tid)) {
      return {
        ok: false,
        error: "该确认已在其他通道回复，请勿重复提交。",
        code: "duplicate",
      };
    }
    if (!pending) {
      // Legacy awaiting without issued gate: first in-process claim wins.
      claimedAwaiting.add(tid);
      return {
        ok: true,
        claimed: true,
        gateId: "",
        legacy: true,
        clearPending: false,
      };
    }
    if (!req) {
      return {
        ok: false,
        error:
          "缺少闸门标识：请在任务日志回复，或点击最新一条通知卡片上的选项（勿点更早的旧卡片）。",
        code: "missing_gate",
      };
    }
    if (req !== pending) {
      return {
        ok: false,
        error: "该确认已失效（可能已在其他通道回复，或已进入下一闸门）。",
        code: "stale",
      };
    }
    claimedAwaiting.add(tid);
    return {
      ok: true,
      claimed: true,
      gateId: pending,
      clearPending: true,
    };
  }

  // Non-awaiting resume (continue from done/failed/stopped): no gate constraint.
  return { ok: true, claimed: false, gateId: "", clearPending: false };
}

import type { AgentDeskDb } from "@agent-desk/db";
import type { RunnerOptions } from "@agent-desk/runner";
import { advanceAutopilotSchedule, dispatchAutopilot } from "./autopilot-dispatch.js";

const TICK_MS = 20_000;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function startAutopilotScheduler(
  db: AgentDeskDb,
  runnerOpts: RunnerOptions,
  dataDir: string,
): void {
  stopAutopilotScheduler();
  // Ensure active rules have a next_run_at after restart.
  for (const ap of db.listAutopilots(500)) {
    if (ap.status === "active" && (!ap.nextRunAt || ap.nextRunAt < Date.now() - 24 * 3600 * 1000)) {
      advanceAutopilotSchedule(db, ap, Date.now());
    }
  }
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const due = db.listDueAutopilots(Date.now(), 20);
      for (const ap of due) {
        try {
          await dispatchAutopilot(db, runnerOpts, dataDir, ap, {
            source: "schedule",
            plannedAt: ap.nextRunAt,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg !== "duplicate_or_busy") {
            console.warn(`[autopilot] fire ${ap.id} failed: ${msg}`);
          }
          // Always advance so a poison rule does not hot-loop.
          advanceAutopilotSchedule(db, ap, Date.now());
        }
      }
    } finally {
      ticking = false;
    }
  };
  void tick();
  timer = setInterval(() => void tick(), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[autopilot] scheduler started (every ${TICK_MS / 1000}s)`);
}

export function stopAutopilotScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Minimal 5-field cron helpers (minute hour dom month dow).
 * Uses the process local timezone (good enough for local-first MVP).
 */

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0=Sun)
];

function parsePart(part: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  const token = part.trim();
  if (!token) throw new Error("empty_cron_field");

  const pushRange = (start: number, end: number, step: number) => {
    for (let v = start; v <= end; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  };

  for (const chunk of token.split(",")) {
    const c = chunk.trim();
    if (!c) continue;
    if (c === "*") {
      pushRange(min, max, 1);
      continue;
    }
    const slash = c.indexOf("/");
    if (slash >= 0) {
      const base = c.slice(0, slash);
      const step = Number(c.slice(slash + 1));
      if (!Number.isInteger(step) || step <= 0) throw new Error(`invalid_cron_step:${c}`);
      if (base === "*") {
        pushRange(min, max, step);
      } else if (base.includes("-")) {
        const [a, b] = base.split("-").map((x) => Number(x));
        if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`invalid_cron_range:${c}`);
        pushRange(a, b, step);
      } else {
        const a = Number(base);
        if (!Number.isInteger(a)) throw new Error(`invalid_cron_value:${c}`);
        pushRange(a, max, step);
      }
      continue;
    }
    if (c.includes("-")) {
      const [a, b] = c.split("-").map((x) => Number(x));
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`invalid_cron_range:${c}`);
      pushRange(a, b, 1);
      continue;
    }
    const n = Number(c);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid_cron_value:${c}`);
    out.add(n);
  }

  if (!out.size) throw new Error(`empty_cron_field:${part}`);
  return out;
}

export function parseCronExpression(expr: string): Array<Set<number>> {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron_must_be_5_fields");
  return parts.map((p, i) => parsePart(p, FIELD_RANGES[i][0], FIELD_RANGES[i][1]));
}

export function validateCronExpression(expr: string): { ok: true } | { ok: false; error: string } {
  try {
    parseCronExpression(expr);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function matches(sets: Array<Set<number>>, d: Date): boolean {
  const minute = d.getMinutes();
  const hour = d.getHours();
  const dom = d.getDate();
  const month = d.getMonth() + 1;
  const dow = d.getDay();
  return (
    sets[0].has(minute) &&
    sets[1].has(hour) &&
    sets[2].has(dom) &&
    sets[3].has(month) &&
    sets[4].has(dow)
  );
}

/** Next fire time strictly after `fromMs` (local tz). Returns 0 if none within lookAheadMs. */
export function nextCronOccurrence(expr: string, fromMs = Date.now(), lookAheadMs = 366 * 24 * 3600 * 1000): number {
  const sets = parseCronExpression(expr);
  const start = new Date(fromMs);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const end = fromMs + lookAheadMs;
  const cursor = new Date(start);
  while (cursor.getTime() <= end) {
    if (matches(sets, cursor)) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return 0;
}

export function previewCronOccurrences(expr: string, count = 3, fromMs = Date.now()): number[] {
  const out: number[] = [];
  let cursor = fromMs;
  for (let i = 0; i < count; i++) {
    const next = nextCronOccurrence(expr, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

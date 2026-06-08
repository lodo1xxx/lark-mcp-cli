// scheduler.ts — setInterval-based governance cron.
// Runs: cohort classifier + auto-tighten sweep + stuck-user nudge.
// start()/stop() lifecycle; cadence from config.
// Stuck nudge is rate-limited (once per user per day) to avoid spam.

import type Database from "better-sqlite3";
import { runClassifier } from "./cohort-classifier.js";
import { runAutoTightenSweep, type AutoTightenConfig } from "./auto-tighten.js";
import type { SendReplyOptions } from "../reply/send-reply.js";

export interface SchedulerConfig {
  /** Interval between sweeps in ms (default 300_000 = 5 min). */
  intervalMs: number;
  /** Daily message cap (for auto-tighten). */
  defaultCap: number;
  /** Auto-tighten thresholds. */
  autoTighten: AutoTightenConfig;
  /** If true, send /help nudges to stuck users. */
  stuckNudgeEnabled: boolean;
  /** lark-cli binary path (for nudges). */
  larkCliBinary: string;
  /** Max chars per nudge message. */
  maxChars?: number;
}

const NUDGE_TEXT =
  "Hi! Tôi thấy bạn đang gặp khó khăn. Thử gõ **/help** để xem hướng dẫn hoặc bắt đầu câu hỏi mới nhé!";

/** Tracks which users were nudged today (userId → ISO date string). */
const nudgedToday = new Map<number, string>();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function sendStuckNudges(
  db: Database.Database,
  cfg: SchedulerConfig,
): Promise<void> {
  if (!cfg.stuckNudgeEnabled) return;

  // Find stuck users who haven't been nudged today
  const stuckUsers = db
    .prepare<[], { id: number; lark_user_id: string; project_id: number }>(
      `SELECT id, lark_user_id, project_id FROM users WHERE cohort = 'stuck'`,
    )
    .all();

  const today = todayIso();

  for (const user of stuckUsers) {
    if (nudgedToday.get(user.id) === today) continue; // already nudged today

    // Find the most recent chat_id for this user from messages
    const chatRow = db
      .prepare<[string], { chat_id: string }>(
        `SELECT chat_id FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(user.lark_user_id);

    if (!chatRow) continue;

    try {
      // Lazy import to avoid circular dep at startup
      const { sendReply } = await import("../reply/send-reply.js");
      const opts: SendReplyOptions = {
        binary: cfg.larkCliBinary,
        maxChars: cfg.maxChars,
      };
      await sendReply(
        db,
        { chatId: chatRow.chat_id, text: NUDGE_TEXT, inboundMessageId: `nudge:${user.id}:${today}`, projectId: user.project_id },
        opts,
      );
      nudgedToday.set(user.id, today);
    } catch (err) {
      console.warn(`[scheduler] stuck nudge failed for user ${user.id}:`, err);
    }
  }
}

let _timer: NodeJS.Timeout | null = null;
let _db: Database.Database | null = null;
let _cfg: SchedulerConfig | null = null;

async function sweep(): Promise<void> {
  if (!_db || !_cfg) return;
  try {
    runClassifier(_db);
    runAutoTightenSweep(_db, _cfg.defaultCap, _cfg.autoTighten);
    await sendStuckNudges(_db, _cfg);
  } catch (err) {
    console.error("[scheduler] sweep error:", err);
  }
}

export function start(db: Database.Database, cfg: SchedulerConfig): void {
  if (_timer) return; // already running
  _db = db;
  _cfg = cfg;
  _timer = setInterval(() => { void sweep(); }, cfg.intervalMs);
  // Don't block process exit
  if (_timer.unref) _timer.unref();
  console.info(`[scheduler] started — interval ${cfg.intervalMs}ms, nudge=${cfg.stuckNudgeEnabled}`);
}

export function stop(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _db = null;
  _cfg = null;
  nudgedToday.clear();
}

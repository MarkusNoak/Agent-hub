import type { Logger } from "./types.js";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const envLevel = (process.env.LOG_LEVEL as Level) ?? "info";
const minIdx = LEVELS.indexOf(envLevel);

function line(level: Level, meta: Record<string, unknown>, msg: string): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  });
}

export function createLogger(base: Record<string, unknown> = {}): Logger {
  return {
    debug(msg, meta = {}) {
      if (LEVELS.indexOf("debug") >= minIdx) console.log(line("debug", { ...base, ...meta }, msg));
    },
    info(msg, meta = {}) {
      if (LEVELS.indexOf("info") >= minIdx) console.log(line("info", { ...base, ...meta }, msg));
    },
    warn(msg, meta = {}) {
      if (LEVELS.indexOf("warn") >= minIdx) console.warn(line("warn", { ...base, ...meta }, msg));
    },
    error(msg, meta = {}) {
      console.error(line("error", { ...base, ...meta }, msg));
    },
  };
}

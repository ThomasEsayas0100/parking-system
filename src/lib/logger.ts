// ---------------------------------------------------------------------------
// Minimal structured logger — pretty in dev, JSON in prod
//
// Zero dependencies. Compatible with Node + Edge runtimes.
// Swap to pino later if you want transports / log shipping.
// ---------------------------------------------------------------------------

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const COLORS: Record<Level, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m",  // cyan
  warn: "\x1b[33m",  // yellow
  error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

// Read NODE_ENV directly here so the logger is available during env
// validation itself (avoids circular import with src/lib/env.ts).
const isProd = process.env.NODE_ENV === "production";
const MIN_LEVEL: Level =
  (process.env.LOG_LEVEL as Level) || (isProd ? "info" : "debug");

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

type LogData = Record<string, unknown>;

function write(level: Level, msg: string, data?: LogData): void {
  if (!shouldLog(level)) return;

  if (isProd) {
    // JSON line for log shippers
    const record = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...(data ?? {}),
    };
    (level === "error" ? console.error : console.log)(JSON.stringify(record));
    return;
  }

  // Dev: pretty output
  const color = COLORS[level];
  const tag = `${color}[${level.padEnd(5)}]${RESET}`;
  const rest = data && Object.keys(data).length > 0 ? " " + JSON.stringify(data) : "";
  (level === "error" ? console.error : console.log)(`${tag} ${msg}${rest}`);
}

export const logger = {
  debug: (msg: string, data?: LogData) => write("debug", msg, data),
  info: (msg: string, data?: LogData) => write("info", msg, data),
  warn: (msg: string, data?: LogData) => write("warn", msg, data),
  error: (msg: string, data?: LogData) => write("error", msg, data),
  // Create a child logger with a fixed `context` field merged into all events.
  child: (context: LogData) => ({
    debug: (msg: string, data?: LogData) => write("debug", msg, { ...context, ...data }),
    info: (msg: string, data?: LogData) => write("info", msg, { ...context, ...data }),
    warn: (msg: string, data?: LogData) => write("warn", msg, { ...context, ...data }),
    error: (msg: string, data?: LogData) => write("error", msg, { ...context, ...data }),
  }),
};

export type Logger = typeof logger;

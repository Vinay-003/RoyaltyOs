export type LogLevel = "info" | "warn" | "error" | "debug";

export function logEvent(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    event,
    ...data,
  };
  const jsonStr = JSON.stringify(entry);
  const prefix = `[RoyaltyOS] ${timestamp} [${level.toUpperCase()}] ${event}`;
  if (level === "error") {
    console.error(`${prefix} ${jsonStr}`);
  } else if (level === "warn") {
    console.warn(`${prefix} ${jsonStr}`);
  } else {
    console.log(`${prefix} ${jsonStr}`);
  }
}

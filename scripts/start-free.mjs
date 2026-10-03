#!/usr/bin/env node
/**
 * Free-tier launcher: API + outbox worker in a single Render free web service.
 *
 * Render's free tier has no background workers or private services, so both
 * processes run here. The web service keeps the deployment alive while it
 * serves traffic; PayPal webhooks wake it and the worker drains the outbox.
 * Exit code follows the first process to exit; SIGTERM is forwarded to both.
 */
import { spawn } from "node:child_process";

const children = [
  spawn("node", ["dist/apps/api/server.js"], { stdio: "inherit" }),
  spawn("node", ["dist/apps/workflows/worker.js"], { stdio: "inherit" }),
];

function killAll(signal) {
  for (const child of children) {
    try {
      if (child.exitCode === null) child.kill(signal);
    } catch {
      // Already gone; nothing to do.
    }
  }
}

process.on("SIGTERM", () => killAll("SIGTERM"));
process.on("SIGINT", () => killAll("SIGINT"));

let settled = false;
for (const child of children) {
  child.on("exit", (code) => {
    if (settled) return;
    settled = true;
    killAll("SIGTERM");
    process.exit(code ?? 1);
  });
}

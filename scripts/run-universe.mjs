import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];
let shuttingDown = false;

function start(label, script) {
  const child = spawn(npmCommand, ["run", script], {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[${label}] stopped${signal ? ` (${signal})` : ` with code ${code ?? 0}`}. Shutting down Universe.`);
    shutdown(code ?? 1);
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 300).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Starting Suno Zara Universe web app + local media worker…\n");
start("WEB", "dev");
start("WORKER", "universe-worker");

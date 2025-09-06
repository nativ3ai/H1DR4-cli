import schedule from "node-schedule";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { loadSchedules, ScheduledTask } from "./config";
import { ConfirmationService } from "../utils/confirmation-service";
import { isAlertLogged, logAlert } from "./alerts";
import { getSettingsManager } from "../utils/settings-manager";

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "schedules.json");
let watcher: fs.FSWatcher | null = null;
let jobs: Record<string, any> = {};

export function startAllTasks(): void {
  const tasks = loadSchedules();
  for (const job of Object.values(jobs)) {
    job.cancel();
  }
  jobs = {};
  for (const task of tasks) {
    jobs[task.id] = schedule.scheduleJob(task.cron, () => runTask(task));
  }
  if (!watcher) {
    const dir = path.dirname(CONFIG_FILE);
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_event, filename) => {
      if (filename === path.basename(CONFIG_FILE)) {
        startAllTasks();
      }
    });
  }
}

function spawnInTerminal(command: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "cmd", "/k", command], { detached: true });
    return;
  }

  if (platform === "darwin") {
    const osa = `tell application \"Terminal\" to do script \"${command.replace(/"/g, '\\"')}\"`;
    spawn("osascript", ["-e", osa], { detached: true });
    return;
  }

  // Linux/Unix: attempt common terminals, falling back if spawning fails.
  const terminals = [
    process.env.TERM_PROGRAM,
    "x-terminal-emulator",
    "gnome-terminal",
    "xterm",
  ].filter(Boolean) as string[];

  const trySpawn = (idx: number): void => {
    const term = terminals[idx];
    if (!term) {
      console.error("Failed to spawn terminal for alert window");
      return;
    }
    const child = spawn(term, ["-e", "bash", "-lc", command], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => trySpawn(idx + 1));
    child.unref();
  };

  trySpawn(0);
}

function runTask(task: ScheduledTask): void {
  const confirmationService = ConfirmationService.getInstance();
  confirmationService.setSessionFlag("allOperations", true);
  if (task.type === "alert" || task.type === "alert-exact") {
    runAlertTask(task);
    return;
  }
  if (process.stdout.isTTY) {
    spawn(task.command, { shell: true, stdio: "inherit" });
  } else {
    // no TTY, open in new terminal
    spawnInTerminal(task.command);
  }
}

function spawnAlertWindow(message: string, duration?: number): void {
  const dur =
    typeof duration === "number"
      ? duration
      : parseInt(process.env.H1DR4_ALERT_DURATION || "30000", 10);
  const sleepSeconds = dur > 0 ? Math.ceil(dur / 1000) : 0;

  const scriptPath = path.join(
    os.tmpdir(),
    `h1dr4-alert-${Date.now()}-${Math.random().toString(16).slice(2)}.sh`
  );
  const script = [
    "#!/usr/bin/env bash",
    "printf '\\a'",
    `echo ${JSON.stringify(`ALERT 🚨 ${message}`)}`,
    `sleep ${sleepSeconds || 100000000}`,
  ].join("\n");
  fs.writeFileSync(scriptPath, script, { mode: 0o700 });
  spawnInTerminal(`bash ${scriptPath}`);
  // Clean up after a short delay; terminal holds a copy after spawn
  setTimeout(() => fs.unlink(scriptPath, () => {}), 60_000);
}

function runAlertTask(task: ScheduledTask): void {
  const manager = getSettingsManager();
  const apiKey = manager.getApiKey();
  const env = { ...process.env } as NodeJS.ProcessEnv;
  if (apiKey) {
    env.GROK_API_KEY = apiKey;
  }
  env.H1DR4_MODEL = env.H1DR4_MODEL || "grok-3-latest";

  // Log the command execution attempt for troubleshooting
  logAlert(task.id, `RUN: ${task.command}`);

  // Execute the alert command inside a login shell so it behaves the same way
  // as commands launched via `schedule add`. This ensures user profiles and
  // PATH lookups are applied even when the daemon runs in the background.
  const child = spawn("bash", ["-lc", task.command], { env });
  let output = "";

  child.stdout.on("data", (data) => {
    output += data.toString();
    if (process.stdout.isTTY) {
      process.stdout.write(data);
    }
  });

  child.stderr.on("data", (data) => {
    output += data.toString();
    if (process.stderr.isTTY) {
      process.stderr.write(data);
    }
  });

  child.on("error", (err) => {
    const message = `ERROR: failed to run command - ${err.message}`;
    logAlert(task.id, message);
    console.error(message);
  });

  child.on("close", async (code) => {
    output = output.trim();

    if (code !== 0) {
      const message = `ERROR: command exited with code ${code}${
        output ? `\n${output}` : ""
      }`;
      logAlert(task.id, message);
      console.error(message);
      return;
    }

    const criteria = task.criteria || "";
    if (!criteria) {
      const message = "ERROR: missing criteria";
      logAlert(task.id, message);
      console.error(message);
      return;
    }

    if (task.type === "alert-exact") {
      const match = output.toLowerCase().includes(criteria.toLowerCase());
      if (match) {
        const message = `ALERT: ${output}`;
        if (!isAlertLogged(task.id, message)) {
          logAlert(task.id, message);
          console.log(`ALERT 🚨 ${output}`);
          spawnAlertWindow(output, task.alertDuration);
        }
      } else {
        const message = `NO MATCH: ${output}`;
        logAlert(task.id, message);
        console.log(message);
      }
      return;
    }

    // For fuzzy criteria, delegate evaluation to a background h1dr4 CLI query.
    // We ask the model if the command output meets the criteria, expecting a YES/NO reply.
    const evalPrompt =
      `Does the following content contain "${criteria}"? ` +
      `Reply with YES or NO only.\n\nCONTENT:\n${output}`;
    // Run the criteria check through a login shell as well so the `h1dr4`
    // binary is resolved using the user's environment. We quote the prompt via
    // JSON.stringify to preserve newlines and other characters.
    const evalCmd = `h1dr4 -p ${JSON.stringify(evalPrompt)} -m ${env.H1DR4_MODEL}`;
    const evalChild = spawn("bash", ["-lc", evalCmd], { env });

    let evalOutput = "";
    evalChild.stdout.on("data", (data) => {
      evalOutput += data.toString();
    });
    evalChild.stderr.on("data", (data) => {
      evalOutput += data.toString();
    });

    evalChild.on("error", (err) => {
      const message = `ERROR: criteria process failed to start - ${err.message}`;
      logAlert(task.id, message);
      console.error(message);
    });

    evalChild.on("close", (evalCode) => {
      const reply = evalOutput.trim().toLowerCase();
      if (evalCode !== 0 || /403/.test(reply) || /error:/i.test(reply)) {
        const msg =
          /403/.test(reply)
            ? "API key lacks permission for criteria evaluation"
            : `criteria evaluation failed${
                evalCode !== 0 ? ` with code ${evalCode}` : ""
              }`;
        const message = `ERROR: ${msg}${reply ? `\n${reply}` : ""}`;
        logAlert(task.id, message);
        console.error(message);
        return;
      }

      const match = /\byes\b/.test(reply);
      if (match) {
        const message = `Your scheduled job id ${task.id} passed the criteria -> ${output}`;
        if (!isAlertLogged(task.id, message)) {
          logAlert(task.id, message);
          console.log(`ALERT 🚨 ${message}`);
          spawnAlertWindow(message, task.alertDuration);
        }
      } else {
        const message = `NO MATCH: ${output}`;
        logAlert(task.id, message);
        console.log(message);
      }
    });
  });
}

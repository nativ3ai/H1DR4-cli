import schedule from "node-schedule";
import { spawn, exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { loadSchedules, ScheduledTask } from "./config";
import { ConfirmationService } from "../utils/confirmation-service";
import { isAlertLogged, logAlert } from "./alerts";
import { getSettingsManager } from "../utils/settings-manager";
import { H1dr4Client } from "../h1dr4/client";

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
  } else if (platform === "darwin") {
    const osa = `tell application \"Terminal\" to do script \"${command.replace(/"/g, '\\"')}\"`;
    spawn("osascript", ["-e", osa], { detached: true });
  } else {
    const term = process.env.TERM_PROGRAM || "x-terminal-emulator";
    spawn(term, ["-e", command], { detached: true });
  }
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

function spawnAlertWindow(message: string): void {
  const duration = process.env.H1DR4_ALERT_DURATION || "30000";
  const nodeCmd = `${process.execPath} -e "console.log(${JSON.stringify(
    "ALERT 🚨 " + message,
  )}); setTimeout(()=>process.exit(0), ${duration})"`;
  spawnInTerminal(nodeCmd);
}

function runAlertTask(task: ScheduledTask): void {
  const manager = getSettingsManager();
  const apiKey = manager.getApiKey();
  const env = { ...process.env } as NodeJS.ProcessEnv;
  if (apiKey) {
    env.GROK_API_KEY = apiKey;
  }
  // Disable reasoning tool to avoid restricted endpoint errors in headless mode
  env.H1DR4_DISABLE_REASONING = "1";

  // Log the command execution attempt for troubleshooting
  logAlert(task.id, `RUN: ${task.command}`);

  exec(task.command, { env }, async (error, stdout, stderr) => {
    const output = (stdout + stderr).trim();
    if (error) {
      const message = `ERROR: ${error.message}${output ? `\n${output}` : ""}`;
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
          spawnAlertWindow(output);
        }
      } else {
        const message = `NO MATCH: ${output}`;
        logAlert(task.id, message);
        console.log(message);
      }
      return;
    }

    try {
      if (!apiKey) {
        const message = "ERROR: missing API key";
        logAlert(task.id, message);
        return;
      }
      const baseURL = manager.getBaseURL();
      const model = manager.getCurrentModel();
      const client = new H1dr4Client(apiKey, model, baseURL);

      const messages = [
        {
          role: "system" as const,
          content:
            "Decide if the command output satisfies the criteria. Respond with YES or NO only.",
        },
        {
          role: "user" as const,
          content: `Command output:\n${output}\n\nCriteria:\n${criteria}`,
        },
      ];

      const resp = await client.chat(messages);
      const reply = resp.choices[0]?.message.content?.trim().toLowerCase();
      const match = reply === "yes";

      if (match) {
        const message = `ALERT: ${output}`;
        if (!isAlertLogged(task.id, message)) {
          logAlert(task.id, message);
          console.log(`ALERT 🚨 ${output}`);
          spawnAlertWindow(output);
        }
      } else {
        const message = `NO MATCH: ${output}`;
        logAlert(task.id, message);
        console.log(message);
      }
    } catch (err: any) {
      const message = `ERROR: ${err?.message || err}`;
      logAlert(task.id, message);
      console.error(message);
    }
  });
}

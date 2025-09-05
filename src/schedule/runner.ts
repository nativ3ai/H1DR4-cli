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

function runAlertTask(task: ScheduledTask): void {
  exec(task.command, async (_error, stdout, stderr) => {
    const output = (stdout + stderr).trim();
    const criteria = task.criteria || "";
    if (!criteria) {
      return;
    }

    if (task.type === "alert-exact") {
      if (output.toLowerCase().includes(criteria.toLowerCase())) {
        if (!isAlertLogged(task.id, output)) {
          logAlert(task.id, output);
          console.log(`ALERT 🚨 ${output}`);
        }
      }
      return;
    }

    try {
      const manager = getSettingsManager();
      const apiKey = manager.getApiKey();
      if (!apiKey) {
        return;
      }
      const baseURL = manager.getBaseURL();
      const model = manager.getCurrentModel();
      const client = new H1dr4Client(apiKey, model, baseURL);
      const prompt = `Command output:\n${output}\n\nCriteria:\n${criteria}\n\nDoes the output satisfy the criteria? Respond with YES or NO.`;
      const response = await client.reason(prompt);
      if (/^\s*yes\b/i.test(response) && !isAlertLogged(task.id, output)) {
        logAlert(task.id, output);
        console.log(`ALERT 🚨 ${output}`);
      }
    } catch {
      // swallow errors to avoid crashing the scheduler
    }
  });
}

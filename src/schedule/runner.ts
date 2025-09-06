import schedule from "node-schedule";
import { spawn, exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { loadSchedules, ScheduledTask } from "./config";
import { ConfirmationService } from "../utils/confirmation-service";

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

function spawnInTerminal(message: string): void {
  const platform = process.platform;

  const hereDoc = (content: string): string => {
    const token = `EOF_${Math.random().toString(16).slice(2)}`;
    return `cat <<'${token}'\n${content}\n${token}\nread`;
  };

  const script = hereDoc(message);

  if (platform === "win32") {
    const escaped = script.replace(/"/g, '""');
    const cmd = `start cmd /k "${escaped}"`;
    spawn("cmd", ["/c", cmd], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "darwin") {
    const escaped = script.replace(/(["\\])/g, "\\$1");
    const osa = `tell application "Terminal" to do script \"${escaped}\"`;
    spawn("osascript", ["-e", osa], { detached: true, stdio: "ignore" }).unref();
  } else {
    const term = process.env.TERM_PROGRAM || "x-terminal-emulator";
    spawn(term, ["-e", "bash", "-lc", script], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
}

function notify(task: ScheduledTask, output: string, matched: boolean): void {
  const message = matched && task.criteria
    ? `TASK ${task.id} matched (criteria: ${task.criteria})`
    : `TASK ${task.id} completed`;
  const fullMessage = `${message}\n${output}`;
  spawnInTerminal(fullMessage);
  if (process.stdout.isTTY) {
    console.log(chalk.green(`\n${fullMessage}\n`));
  }
}

function runTask(task: ScheduledTask): void {
  const confirmationService = ConfirmationService.getInstance();
  confirmationService.setSessionFlag("allOperations", true);
  if (!task.notify && !task.criteria) {
    if (process.stdout.isTTY) {
      spawn(task.command, { shell: true, stdio: "inherit" });
    } else {
      spawnInTerminal(task.command);
    }
    return;
  }

  exec(task.command, { encoding: "utf8" }, (_err, stdout, stderr) => {
    const output = `${stdout}${stderr}`;
    const matched = task.criteria ? output.includes(task.criteria) : false;
    if (task.notify || matched) {
      notify(task, output, matched);
    }
  });
}

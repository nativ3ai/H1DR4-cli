import schedule from "node-schedule";
import { exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { loadAlerts, AlertTask, addAlertEvent } from "./config";
import { ConfirmationService } from "../utils/confirmation-service";

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "alerts.json");
let watcher: fs.FSWatcher | null = null;
let jobs: Record<string, any> = {};
const activeNotifications = new Set<string>();

export function startAllAlerts(): void {
  const alerts = loadAlerts();
  for (const job of Object.values(jobs)) {
    job.cancel();
  }
  jobs = {};
  for (const alert of alerts) {
    jobs[alert.id] = schedule.scheduleJob(alert.cron, () => runAlert(alert));
  }
  if (!watcher) {
    const dir = path.dirname(CONFIG_FILE);
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_event, filename) => {
      if (filename === path.basename(CONFIG_FILE)) {
        startAllAlerts();
      }
    });
  }
}

function runAlert(alert: AlertTask): void {
  exec(alert.command, { encoding: "utf8" }, (_error, stdout, stderr) => {
    const output = `${stdout}${stderr}`;
    if (output.includes(alert.criteria)) {
      addAlertEvent({
        id: alert.id,
        timestamp: new Date().toISOString(),
        output,
      });
      notify(alert, output);
    }
  });
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

function notify(alert: AlertTask, output: string): void {
  if (activeNotifications.has(alert.id)) {
    return;
  }
  activeNotifications.add(alert.id);

  const confirmationService = ConfirmationService.getInstance();
  confirmationService.setSessionFlag("allOperations", true);
  const message = `ALERT ${alert.id} triggered (criteria: ${alert.criteria})`;
  const fullMessage = `${message}\n${output}`;

  spawnInTerminal(fullMessage);
  if (process.stdout.isTTY) {
    console.log(chalk.red(`\n${fullMessage}\n`));
  }

  setTimeout(() => activeNotifications.delete(alert.id), 1000);
}

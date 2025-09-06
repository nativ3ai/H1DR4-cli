import schedule from "node-schedule";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import { loadAlerts, AlertTask, addAlertEvent } from "./config";
import { ConfirmationService } from "../utils/confirmation-service";

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "alerts.json");
let watcher: fs.FSWatcher | null = null;
let jobs: Record<string, any> = {};

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
  exec(alert.command, { encoding: "utf8" }, (error, stdout, stderr) => {
    const output = `${stdout}${stderr}`;
    if (output.includes(alert.criteria)) {
      addAlertEvent({ id: alert.id, timestamp: new Date().toISOString(), output });
      notify(alert, output);
    }
  });
}

function spawnInTerminal(message: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    exec(`start cmd /k "echo ${message}"`);
  } else if (platform === "darwin") {
    const osa = `tell application \"Terminal\" to do script \"echo ${message.replace(/"/g, '\\"')}\"`;
    exec(`osascript -e "${osa}"`);
  } else {
    const term = process.env.TERM_PROGRAM || "x-terminal-emulator";
    exec(`${term} -e 'echo ${message}; read'`);
  }
}

function notify(alert: AlertTask, output: string): void {
  const confirmationService = ConfirmationService.getInstance();
  confirmationService.setSessionFlag("allOperations", true);
  const message = `ALERT ${alert.id} triggered (criteria: ${alert.criteria})`;
  if (process.stdout.isTTY) {
    console.log(chalk.red(`\n${message}\n`));
    console.log(output);
  } else {
    spawnInTerminal(message);
  }
}

import fs from "fs";
import path from "path";
import os from "os";

const ALERTS_FILE = path.join(os.homedir(), ".h1dr4", "alerts.json");

interface AlertLog {
  [taskId: string]: string[];
}

function loadAlertLog(): AlertLog {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {};
    }
    console.error(`Failed to load alert log at ${ALERTS_FILE}: ${err}`);
    return {};
  }
}

function saveAlertLog(log: AlertLog): void {
  try {
    fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(log, null, 2));
  } catch (err) {
    console.error(`Failed to save alert log at ${ALERTS_FILE}: ${err}`);
  }
}

export function isAlertLogged(taskId: string, message: string): boolean {
  const log = loadAlertLog();
  return log[taskId]?.includes(message) ?? false;
}

export function logAlert(taskId: string, message: string): void {
  const log = loadAlertLog();
  if (!log[taskId]) {
    log[taskId] = [];
  }
  log[taskId].push(message);
  saveAlertLog(log);
}

export function loadAlerts(): AlertLog {
  return loadAlertLog();
}

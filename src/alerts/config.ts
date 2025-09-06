import fs from "fs";
import path from "path";
import os from "os";

export interface AlertTask {
  id: string;
  cron: string;
  command: string;
  criteria: string;
}

export interface AlertEvent {
  id: string;
  timestamp: string;
  output: string;
}

const ALERTS_FILE = path.join(os.homedir(), ".h1dr4", "alerts.json");
const EVENTS_FILE = path.join(os.homedir(), ".h1dr4", "alert-events.json");

export function loadAlerts(): AlertTask[] {
  try {
    return JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function saveAlerts(alerts: AlertTask[]): void {
  fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
  fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
}

export function addAlert(alert: AlertTask): void {
  const alerts = loadAlerts();
  alerts.push(alert);
  saveAlerts(alerts);
}

export function removeAlert(id: string): void {
  const alerts = loadAlerts().filter((a) => a.id !== id);
  saveAlerts(alerts);
}

export function loadAlertEvents(): AlertEvent[] {
  try {
    return JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function addAlertEvent(event: AlertEvent): void {
  const events = loadAlertEvents();
  events.push(event);
  fs.mkdirSync(path.dirname(EVENTS_FILE), { recursive: true });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

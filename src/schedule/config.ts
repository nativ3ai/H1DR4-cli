import fs from "fs";
import path from "path";
import os from "os";

export type ScheduleType = "command" | "alert";

export interface ScheduledTask {
  id: string;
  cron: string;
  command: string;
  type?: ScheduleType;
  criteria?: string;
}

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "schedules.json");

export function loadSchedules(): ScheduledTask[] {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return [];
  }
}

export function saveSchedules(tasks: ScheduledTask[]): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(tasks, null, 2));
}

export function addSchedule(task: ScheduledTask): void {
  const tasks = loadSchedules();
  tasks.push(task);
  saveSchedules(tasks);
}

export function removeSchedule(id: string): void {
  const tasks = loadSchedules().filter((t) => t.id !== id);
  saveSchedules(tasks);
}

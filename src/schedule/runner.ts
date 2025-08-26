import schedule from "node-schedule";
import { spawn } from "child_process";
import { loadSchedules, ScheduledTask } from "./config";
import { ConfirmationService } from "../utils/confirmation-service";

let jobs: Record<string, schedule.Job> = {};

export function startAllTasks(): void {
  const tasks = loadSchedules();
  for (const job of Object.values(jobs)) {
    job.cancel();
  }
  jobs = {};
  for (const task of tasks) {
    jobs[task.id] = schedule.scheduleJob(task.cron, () => runTask(task));
  }
}

function runTask(task: ScheduledTask): void {
  const confirmationService = ConfirmationService.getInstance();
  confirmationService.setSessionFlag("allOperations", true);
  spawn(task.command, { shell: true, stdio: "inherit" });
}

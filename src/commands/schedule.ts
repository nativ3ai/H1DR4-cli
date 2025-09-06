import { Command } from "commander";
import chalk from "chalk";
import { addSchedule, loadSchedules, removeSchedule } from "../schedule/config";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export function createScheduleCommand(): Command {
  const scheduleCommand = new Command("schedule");
  scheduleCommand.description("Manage scheduled tasks");

  scheduleCommand
    .command("add <cron> <cmd...>")
    .description(
      "Schedule a command using a cron expression. Optionally notify on completion or only when output matches criteria. Commands may include headless prompts via `h1dr4 -p`/`--prompt` and `--max-tool-rounds`"
    )
    .option("-n, --notify", "Show a notification when the command finishes")
    .option("-c, --criteria <text>", "Alert only when command output contains text")
    .action((cron: string, cmd: string[], options: { notify?: boolean; criteria?: string }) => {
      const command = cmd.join(" ");
      const task = {
        id: randomUUID(),
        cron,
        command,
        notify: options.notify,
        criteria: options.criteria,
      };
      addSchedule(task);
      reloadSchedulers();
      console.log(chalk.green(`✓ Scheduled task ${task.id}`));
    });

  scheduleCommand
    .command("list")
    .description("List scheduled tasks")
    .action(() => {
      const tasks = loadSchedules();
      if (tasks.length === 0) {
        console.log(chalk.yellow("No tasks scheduled"));
        return;
      }
      console.log(chalk.bold("Scheduled tasks:"));
      tasks.forEach((t) => {
        const flags = [
          t.notify ? "notify" : null,
          t.criteria ? `criteria: ${t.criteria}` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const extra = flags ? ` [${flags}]` : "";
        console.log(`${t.id}: ${t.cron} -> ${t.command}${extra}`);
      });
    });

  scheduleCommand
    .command("remove <id>")
    .description("Remove a scheduled task")
    .action((id: string) => {
      removeSchedule(id);
      reloadSchedulers();
      console.log(chalk.green(`✓ Removed task ${id}`));
    });
  
  scheduleCommand.addHelpText(
    "after",
    `\nExamples:\n  # weekly summary every Monday at 9am\n  h1dr4 schedule add "0 9 * * 1" "h1dr4 -p 'run weekly summary'"\n\n  # alert when a script output contains success and show a popup\n  h1dr4 schedule add --notify --criteria "success" "*/30 * * * *" "./script.sh"\n\n  # limit tool rounds for a headless prompt\n  h1dr4 schedule add "0 * * * *" "h1dr4 --max-tool-rounds 25 -p 'check status'"\n`
  );

  return scheduleCommand;
}

const PID_FILE = path.join(os.homedir(), ".h1dr4", "schedule.pid");
const UI_PID_FILE = path.join(os.homedir(), ".h1dr4", "ui.pid");
const DAEMON_PATH = path.join(__dirname, "../schedule/daemon.js");

function reloadSchedulers(): void {
  let notified = false;
  try {
    const uiPid = parseInt(fs.readFileSync(UI_PID_FILE, "utf8"), 10);
    process.kill(uiPid, "SIGUSR1");
    notified = true;
  } catch {}
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
    process.kill(pid, "SIGUSR1");
    notified = true;
  } catch {}
  if (!notified) {
    ensureDaemonRunning();
  }
}

function ensureDaemonRunning(): void {
  try {
    const uiPid = parseInt(fs.readFileSync(UI_PID_FILE, "utf8"), 10);
    process.kill(uiPid, 0);
    return; // UI active, skip daemon
  } catch {}
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
    process.kill(pid, 0);
    return; // daemon already running
  } catch {}
  const child = spawn(process.execPath, [DAEMON_PATH], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

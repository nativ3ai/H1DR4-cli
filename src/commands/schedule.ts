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
    .description("Schedule a command using a cron expression")
    .action((cron: string, cmd: string[]) => {
      const command = cmd.join(" ");
      const task = { id: randomUUID(), cron, command };
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
      tasks.forEach((t) => console.log(`${t.id}: ${t.cron} -> ${t.command}`));
    });

  scheduleCommand
    .command("remove <id>")
    .description("Remove a scheduled task")
    .action((id: string) => {
      removeSchedule(id);
      reloadSchedulers();
      console.log(chalk.green(`✓ Removed task ${id}`));
    });

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

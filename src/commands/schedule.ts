import { Command } from "commander";
import chalk from "chalk";
import {
  addSchedule,
  loadSchedules,
  removeSchedule,
  ImpactLevel,
} from "../schedule/config";
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
    .command("watch <cron>")
    .description("Schedule an event watchlist")
    .option("-t, --ticker <ticker...>", "Tickers to monitor")
    .option("-k, --keyword <keyword...>", "Keywords to monitor")
    .option("-s, --source <source...>", "Sources or accounts to monitor")
    .option("-c, --criteria <criteria>", "Evaluation criteria for alerts")
    .option(
      "--threshold <level>",
      "Alert threshold (Low|Mid-High|High)",
      "High"
    )
    .action(
      (
        cron: string,
        options: {
          ticker?: string[];
          keyword?: string[];
          source?: string[];
          criteria?: string;
          threshold: ImpactLevel;
        }
      ) => {
        const watch = {
          tickers: options.ticker,
          keywords: options.keyword,
          sources: options.source,
          criteria: options.criteria,
          threshold: options.threshold,
        };
        const task = { id: randomUUID(), cron, watch };
        addSchedule(task);
        reloadSchedulers();
        console.log(chalk.green(`✓ Scheduled watch ${task.id}`));
      }
    );

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
        if (t.watch) {
          console.log(`${t.id}: ${t.cron} -> watch`);
        } else if (t.command) {
          console.log(`${t.id}: ${t.cron} -> ${t.command}`);
        }
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

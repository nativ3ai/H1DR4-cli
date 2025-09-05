import { Command } from "commander";
import chalk from "chalk";
import { addSchedule, loadSchedules, removeSchedule } from "../schedule/config";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { loadAlerts } from "../schedule/alerts";

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
    .command("alert <cron> <cmd...>")
    .requiredOption("-c, --criteria <criteria>", "Natural-language criteria for Grok evaluation")
    .option("--popup <mode>", "Alert window: short (30s) or long", "short")
    .description(
      "Schedule a command that triggers alerts when Grok determines the output meets the criteria",
    )
    .action((cron: string, cmd: string[], options: { criteria: string; popup: string }) => {
      const command = cmd.join(" ");
      const alertDuration = options.popup === "long" ? 0 : 30000;
      const task = {
        id: randomUUID(),
        cron,
        command,
        type: "alert" as const,
        criteria: options.criteria,
        alertDuration,
      };
      addSchedule(task);
      reloadSchedulers();
      console.log(chalk.green(`✓ Scheduled alert ${task.id}`));
    });

  scheduleCommand
    .command("alert-exact <cron> <cmd...>")
    .requiredOption("-c, --criteria <criteria>", "Substring to match (case-insensitive)")
    .option("--popup <mode>", "Alert window: short (30s) or long", "short")
    .description(
      "Schedule a command that triggers alerts only when output contains the exact criteria substring",
    )
    .action((cron: string, cmd: string[], options: { criteria: string; popup: string }) => {
      const command = cmd.join(" ");
      const alertDuration = options.popup === "long" ? 0 : 30000;
      const task = {
        id: randomUUID(),
        cron,
        command,
        type: "alert-exact" as const,
        criteria: options.criteria,
        alertDuration,
      };
      addSchedule(task);
      reloadSchedulers();
      console.log(chalk.green(`✓ Scheduled exact-match alert ${task.id}`));
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
        if (t.type === "alert" || t.type === "alert-exact") {
          const mode = t.type === "alert-exact" ? "exact" : "grok";
          const popup = t.alertDuration === 0 ? "long" : "short";
          console.log(
            `${t.id}: ${t.cron} -> ${t.command} [alert-${mode}: ${t.criteria}; popup: ${popup}]`,
          );
        } else {
          console.log(`${t.id}: ${t.cron} -> ${t.command}`);
        }
      });
    });

  scheduleCommand
    .command("alerts")
    .description("Show triggered alerts")
    .action(() => {
      const alerts = loadAlerts();
      const entries = Object.entries(alerts);
      if (entries.length === 0) {
        console.log(chalk.yellow("No alerts triggered"));
        return;
      }
      console.log(chalk.bold("Triggered alerts:"));
      for (const [, messages] of entries) {
        messages.forEach((m) => {
          if (m.startsWith("RUN:")) {
            return; // skip run logs in summary view
          }
          if (m.startsWith("ALERT:")) {
            console.log(`ALERT 🚨 ${m.slice(6).trim()}`);
          } else {
            console.log(m);
          }
        });
      }
    });

  scheduleCommand
    .command("watch")
    .description("Watch alert log for new entries in real time")
    .action(() => {
      const logPath = path.join(os.homedir(), ".h1dr4", "alerts.json");
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, "{}", "utf8");
      }

      console.log(chalk.dim(`Watching ${logPath} (press Ctrl+C to exit)`));

      let previous = loadAlerts();
      const printMessages = (messages: string[]) => {
        messages.forEach((m) => {
          if (m.startsWith("ALERT:")) {
            console.log(`ALERT 🚨 ${m.slice(6).trim()}`);
          } else if (m.startsWith("NO MATCH:") || m.startsWith("ERROR:")) {
            console.log(m);
          } else if (m.startsWith("RUN:")) {
            console.log(chalk.blue(m));
          } else {
            console.log(m);
          }
        });
      };

      // Print existing alerts once at startup
      Object.values(previous).forEach(printMessages);

      fs.watchFile(logPath, { interval: 500 }, () => {
        const current = loadAlerts();
        for (const [id, msgs] of Object.entries(current)) {
          const prev = previous[id] || [];
          const newMsgs = msgs.slice(prev.length);
          if (newMsgs.length > 0) {
            printMessages(newMsgs);
          }
        }
        previous = current;
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
const DAEMON_PATH = path.join(__dirname, "../schedule/daemon.js");

function reloadSchedulers(): void {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
    process.kill(pid, "SIGUSR1");
  } catch {
    ensureDaemonRunning();
  }
}

function ensureDaemonRunning(): void {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
    process.kill(pid, 0);
    return; // daemon already running
  } catch {}
  const logDir = path.join(os.homedir(), ".h1dr4");
  const logPath = path.join(logDir, "daemon.log");
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const out = fs.openSync(logPath, "a");
    const child = spawn(process.execPath, [DAEMON_PATH], {
      detached: true,
      stdio: ["ignore", out, out],
      cwd: path.join(__dirname, "..", ".."),
      env: process.env,
    });
    child.unref();
  } catch (err) {
    console.error(`Failed to start daemon: ${err}`);
  }
}

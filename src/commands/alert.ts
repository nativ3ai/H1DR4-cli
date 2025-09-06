import { Command } from "commander";
import chalk from "chalk";
import { addAlert, loadAlerts, removeAlert, loadAlertEvents } from "../alerts/config";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export function createAlertCommand(): Command {
  const alertCommand = new Command("alert");
  alertCommand.description(
    "Manage alerts that run commands on a schedule and trigger when output matches criteria"
  );

  alertCommand
    .command("add <cron> <criteria> <cmd...>")
    .description(
      "Add an alert with cron schedule, match text, and command to run"
    )
    .action((cron: string, criteria: string, cmd: string[]) => {
      const command = cmd.join(" ");
      const alert = { id: randomUUID(), cron, command, criteria };
      addAlert(alert);
      reloadAlerts();
      console.log(chalk.green(`✓ Alert ${alert.id} added`));
    });

  alertCommand
    .command("list")
    .description("List configured alerts")
    .action(() => {
      const alerts = loadAlerts();
      if (alerts.length === 0) {
        console.log(chalk.yellow("No alerts configured"));
        return;
      }
      console.log(chalk.bold("Alerts:"));
      alerts.forEach((a) =>
        console.log(`${a.id}: ${a.cron} -> ${a.command} [${a.criteria}]`)
      );
    });

  alertCommand
    .command("remove <id>")
    .description("Remove an alert")
    .action((id: string) => {
      removeAlert(id);
      reloadAlerts();
      console.log(chalk.green(`✓ Removed alert ${id}`));
    });

  alertCommand
    .command("history")
    .description("Show triggered alert events")
    .action(() => {
      const events = loadAlertEvents();
      if (events.length === 0) {
        console.log(chalk.yellow("No alert events"));
        return;
      }
      console.log(chalk.bold("Alert events:"));
      events.forEach((e) =>
        console.log(`${e.timestamp} - ${e.id}\n${e.output}\n`)
      );
    });

  alertCommand.addHelpText(
    "after",
    `\nExamples:\n  # alert if latest news mentions trump\n  h1dr4 alert add "* * * * *" "trump" "h1dr4 news latest"\n  \n  # list configured alerts\n  h1dr4 alert list\n  \n  # show triggered events\n  h1dr4 alert history\n`
  );

  return alertCommand;
}

const PID_FILE = path.join(os.homedir(), ".h1dr4", "alerts.pid");
const UI_PID_FILE = path.join(os.homedir(), ".h1dr4", "ui.pid");
const DAEMON_PATH = path.join(__dirname, "../alerts/daemon.js");

function reloadAlerts(): void {
  let notified = false;
  try {
    const uiPid = parseInt(fs.readFileSync(UI_PID_FILE, "utf8"), 10);
    process.kill(uiPid, "SIGUSR2");
    notified = true;
  } catch {}
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
    process.kill(pid, "SIGUSR2");
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
    return;
  } catch {}
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
    process.kill(pid, 0);
    return;
  } catch {}
  const child = spawn(process.execPath, [DAEMON_PATH], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

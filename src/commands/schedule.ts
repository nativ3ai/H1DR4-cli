import { Command } from "commander";
import chalk from "chalk";
import { addSchedule, loadSchedules, removeSchedule } from "../schedule/config";
import { startAllTasks } from "../schedule/runner";
import { randomUUID } from "crypto";

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
      startAllTasks();
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
      startAllTasks();
      console.log(chalk.green(`✓ Removed task ${id}`));
    });

  return scheduleCommand;
}

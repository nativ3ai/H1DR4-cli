import schedule from "node-schedule";
import { spawn, exec } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { loadSchedules, ScheduledTask } from "./config";
import { ConfirmationService } from "../utils/confirmation-service";
import { isAlertLogged, logAlert } from "./alerts";
import { getSettingsManager } from "../utils/settings-manager";
import { H1dr4Client, H1dr4Tool } from "../h1dr4/client";

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "schedules.json");
let watcher: fs.FSWatcher | null = null;
let jobs: Record<string, any> = {};

export function startAllTasks(): void {
  const tasks = loadSchedules();
  for (const job of Object.values(jobs)) {
    job.cancel();
  }
  jobs = {};
  for (const task of tasks) {
    jobs[task.id] = schedule.scheduleJob(task.cron, () => runTask(task));
  }
  if (!watcher) {
    const dir = path.dirname(CONFIG_FILE);
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_event, filename) => {
      if (filename === path.basename(CONFIG_FILE)) {
        startAllTasks();
      }
    });
  }
}

function spawnInTerminal(command: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "cmd", "/k", command], { detached: true });
  } else if (platform === "darwin") {
    const osa = `tell application \"Terminal\" to do script \"${command.replace(/"/g, '\\"')}\"`;
    spawn("osascript", ["-e", osa], { detached: true });
  } else {
    const term = process.env.TERM_PROGRAM || "x-terminal-emulator";
    spawn(term, ["-e", command], { detached: true });
  }
}

function runTask(task: ScheduledTask): void {
  const confirmationService = ConfirmationService.getInstance();
  confirmationService.setSessionFlag("allOperations", true);
  if (task.type === "alert" || task.type === "alert-exact") {
    runAlertTask(task);
    return;
  }
  if (process.stdout.isTTY) {
    spawn(task.command, { shell: true, stdio: "inherit" });
  } else {
    // no TTY, open in new terminal
    spawnInTerminal(task.command);
  }
}

function runAlertTask(task: ScheduledTask): void {
  exec(task.command, async (error, stdout, stderr) => {
    if (error) {
      const message = `ERROR: ${error.message}`;
      if (!isAlertLogged(task.id, message)) {
        logAlert(task.id, message);
      }
      console.error(message);
      return;
    }

    const output = (stdout + stderr).trim();
    const criteria = task.criteria || "";
    if (!criteria) {
      const message = "ERROR: missing criteria";
      if (!isAlertLogged(task.id, message)) {
        logAlert(task.id, message);
      }
      console.error(message);
      return;
    }

    if (task.type === "alert-exact") {
      if (output.toLowerCase().includes(criteria.toLowerCase())) {
        if (!isAlertLogged(task.id, output)) {
          logAlert(task.id, output);
          console.log(`ALERT 🚨 ${output}`);
        }
      } else {
        const message = `NO MATCH: ${output}`;
        if (!isAlertLogged(task.id, message)) {
          logAlert(task.id, message);
        }
        console.log(message);
      }
      return;
    }

    try {
      const manager = getSettingsManager();
      const apiKey = manager.getApiKey();
      if (!apiKey) {
        const message = "ERROR: missing API key";
        if (!isAlertLogged(task.id, message)) {
          logAlert(task.id, message);
        }
        return;
      }
      const baseURL = manager.getBaseURL();
      const model = manager.getCurrentModel();
      const client = new H1dr4Client(apiKey, model, baseURL);

      // Use a binary tool so Grok must respond with YES or NO
      const tool: H1dr4Tool = {
        type: "function",
        function: {
          name: "alert_match",
          description: "Return YES if output satisfies the criteria, otherwise NO",
          parameters: {
            type: "object",
            properties: {
              result: { type: "string", enum: ["YES", "NO"] },
            },
            required: ["result"],
          },
        },
      };

      const messages = [
        {
          role: "system" as const,
          content: "Decide if the command output satisfies the criteria by calling the alert_match tool.",
        },
        {
          role: "user" as const,
          content: `Command output:\n${output}\n\nCriteria:\n${criteria}`,
        },
      ];

      const resp = await client.chat(messages, [tool]);
      const toolCall = resp.choices[0]?.message.tool_calls?.[0];
      let match = false;
      if (toolCall) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          match = args.result === "YES";
        } catch {
          match = false;
        }
      }

      if (match) {
        if (!isAlertLogged(task.id, output)) {
          logAlert(task.id, output);
          console.log(`ALERT 🚨 ${output}`);
        }
      } else {
        const message = `NO MATCH: ${output}`;
        if (!isAlertLogged(task.id, message)) {
          logAlert(task.id, message);
        }
        console.log(message);
      }
    } catch (err: any) {
      const message = `ERROR: ${err?.message || err}`;
      if (!isAlertLogged(task.id, message)) {
        logAlert(task.id, message);
      }
      console.error(message);
    }
  });
}

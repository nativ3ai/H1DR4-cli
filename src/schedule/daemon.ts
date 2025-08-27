import fs from "fs";
import path from "path";
import os from "os";
import { startAllTasks } from "./runner";

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "schedules.json");
const PID_FILE = path.join(os.homedir(), ".h1dr4", "schedule.pid");

function writePid() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch {
    // ignore write errors
  }
}

function removePid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

writePid();
startAllTasks();

try {
  fs.watch(CONFIG_FILE, () => {
    startAllTasks();
  });
} catch {
  // ignore watch errors
}

process.on("SIGUSR1", startAllTasks);

process.on("exit", removePid);
process.on("SIGINT", () => {
  removePid();
  process.exit(0);
});

// keep process alive
setInterval(() => {}, 1 << 30);

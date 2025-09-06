import fs from "fs";
import path from "path";
import os from "os";
import { startAllAlerts } from "./runner";

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "alerts.json");
const PID_FILE = path.join(os.homedir(), ".h1dr4", "alerts.pid");

function writePid() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch {
    // ignore
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
startAllAlerts();

try {
  fs.watch(CONFIG_FILE, () => {
    startAllAlerts();
  });
} catch {
  // ignore watch errors
}

process.on("SIGUSR2", startAllAlerts);
process.on("exit", removePid);
process.on("SIGINT", () => {
  removePid();
  process.exit(0);
});

setInterval(() => {}, 1 << 30);

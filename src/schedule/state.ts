import fs from "fs";
import path from "path";
import os from "os";

interface WatchState {
  seenIds: string[];
}

const STATE_FILE = path.join(os.homedir(), ".h1dr4", "watch-state.json");

export function loadWatchState(): Record<string, WatchState> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

export function saveWatchState(state: Record<string, WatchState>): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

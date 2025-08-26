import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_FILE = path.join(os.homedir(), ".h1dr4", "rss-feeds.json");

export function loadRSSConfig(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveRSSConfig(feeds: Record<string, string>): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(feeds, null, 2));
}

export function addRSSFeed(name: string, url: string): void {
  const feeds = loadRSSConfig();
  feeds[name] = url;
  saveRSSConfig(feeds);
}

export function removeRSSFeed(name: string): void {
  const feeds = loadRSSConfig();
  delete feeds[name];
  saveRSSConfig(feeds);
}

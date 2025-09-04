import chalk from "chalk";
import Parser from "rss-parser";
import { ScheduledTask, ImpactLevel } from "./config";
import { loadWatchState, saveWatchState } from "./state";

interface WatchItem {
  id: string;
  summary: string;
  metadata: Record<string, string>;
}

function detectContractAddress(text: string): string | undefined {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : undefined;
}

async function fetchNewItems(task: ScheduledTask): Promise<WatchItem[]> {
  const parser = new Parser();
  const items: WatchItem[] = [];

  const keywords = task.watch?.keywords?.map((k) => k.toLowerCase());
  const tickers = task.watch?.tickers?.map((t) => t.toLowerCase());
  const sources = task.watch?.sources || [];

  if (sources.length === 0) return items;

  for (const rawSource of sources) {
    const handle = rawSource.replace(/^@/, "");
    const url = `https://nitter.net/${handle}/rss`;
    try {
      const feed = await parser.parseURL(url);
      for (const entry of feed.items || []) {
        const content = `${entry.title || ""} ${
          entry.contentSnippet || ""
        }`.trim();
        const lower = content.toLowerCase();

        const matchesKeyword = keywords
          ? keywords.some((k) => lower.includes(k))
          : false;
        const matchesTicker = tickers
          ? tickers.some((t) => lower.includes(t))
          : false;
        const contract = detectContractAddress(content);

        if (keywords || tickers) {
          if (!matchesKeyword && !matchesTicker && !contract) continue;
        } else if (!contract) {
          continue;
        }

        const meta: Record<string, string> = { source: rawSource };
        if (entry.link) meta.link = entry.link;
        if (contract) meta.contractAddress = contract;

        items.push({
          id: entry.id || entry.guid || entry.link || entry.pubDate || content,
          summary: content || "New post",
          metadata: meta,
        });
      }
    } catch (error) {
      console.warn(
        `Failed to fetch source ${rawSource}: ${(error as Error).message}`
      );
    }
  }

  return items;
}

function analyzeImpact(item: WatchItem): ImpactLevel {
  const keywords = item.metadata.keywords?.toLowerCase() || "";
  if (item.metadata.contractAddress) return "High";
  if (keywords.includes("trump") || keywords.includes("fed")) {
    return "Mid-High";
  }
  return "Low";
}

export async function runWatchTask(task: ScheduledTask): Promise<void> {
  const state = loadWatchState();
  const taskState = state[task.id] || { seenIds: [] };
  const items = await fetchNewItems(task);
  const unseen = items.filter((i) => !taskState.seenIds.includes(i.id));
  if (unseen.length === 0) return;
  const threshold = task.watch?.threshold || "Low";
  const levels: Record<ImpactLevel, number> = { Low: 1, "Mid-High": 2, High: 3 };
  for (const item of unseen) {
    const impact = analyzeImpact(item);
    if (levels[impact] >= levels[threshold]) {
      console.log(
        chalk.yellow(
          `[Alert] ${item.summary} -> Estimated ${impact} impact`
        )
      );
    }
    taskState.seenIds.push(item.id);
  }
  state[task.id] = taskState;
  saveWatchState(state);
}

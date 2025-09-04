import chalk from "chalk";
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
  // Placeholder for event detection logic integrating RSS, MCP, etc.
  const keywords = task.watch?.keywords?.join(", ");
  const tickers = task.watch?.tickers?.join(", ");
  const sources = task.watch?.sources?.join(", ");
  if (!keywords && !tickers && !sources) {
    return [];
  }
  const meta: Record<string, string> = {};
  if (keywords) meta.keywords = keywords;
  if (tickers) meta.tickers = tickers;
  if (sources) meta.sources = sources;
  // Simulate a detected summary
  const summary = `Detected event for ${keywords || tickers || sources}`;
  const contract = detectContractAddress(summary);
  if (contract) meta.contractAddress = contract;
  return [
    {
      id: Date.now().toString(),
      summary,
      metadata: meta,
    },
  ];
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

import chalk from "chalk";
import { H1dr4Client } from "../h1dr4/client";
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
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    console.warn("GROK_API_KEY not set; skipping watch task");
    return [];
  }

  const client = new H1dr4Client(
    apiKey,
    process.env.H1DR4_MODEL,
    process.env.GROK_BASE_URL
  );

  const keywords = task.watch?.keywords || [];
  const tickers = task.watch?.tickers || [];
  const sources = task.watch?.sources || [];

  const queryParts: string[] = [];
  queryParts.push(
    ...keywords,
    ...tickers.map((t) => `$${t}`),
    ...sources.map((s) => `from:${s.replace(/^@/, "")}`)
  );

  if (queryParts.length === 0) {
    return [];
  }

  const query = queryParts.join(" ");
  try {
    const response = await client.search(query, {
      mode: "on",
      max_search_results: 10,
    } as any);
    const content = response.choices[0]?.message.content || "";
    const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const items: WatchItem[] = [];
    for (const line of lines) {
      const contract = detectContractAddress(line);
      const meta: Record<string, string> = {};
      const urlMatch = line.match(/https?:\/\/\S+/);
      if (urlMatch) meta.link = urlMatch[0];
      if (contract) meta.contractAddress = contract;
      items.push({ id: line, summary: line, metadata: meta });
    }
    return items;
  } catch (error) {
    console.warn(`Live search failed: ${(error as Error).message}`);
    return [];
  }
}

function analyzeImpact(item: WatchItem): ImpactLevel {
  const lower = item.summary.toLowerCase();
  if (item.metadata.contractAddress) return "High";
  if (lower.includes("trump") || lower.includes("fed")) {
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

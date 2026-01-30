import { LiveSearchQueryOptions, LiveSearchSummary } from "./types";

export interface SearchProvider {
  search(query: string, options?: LiveSearchQueryOptions): Promise<LiveSearchSummary>;
}

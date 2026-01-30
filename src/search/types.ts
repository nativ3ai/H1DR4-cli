export interface LiveSearchQueryOptions {
  maxSources?: number;
  citations?: boolean;
  returnRaw?: boolean;
}

export interface DiscoveryResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface CrawlResult {
  url: string;
  title?: string;
  content?: string;
  headings?: string[];
}

export interface LiveSearchSummary {
  answer: string;
  key_points: string[];
  sources: Array<{ url: string; title?: string }>;
  confidence?: string;
  raw_sources?: CrawlResult[];
  discovery?: DiscoveryResult[];
}

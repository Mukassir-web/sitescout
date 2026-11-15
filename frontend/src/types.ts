export type Stage = "queued" | "interpreting" | "executing" | "processing" | "succeeded" | "partial" | "failed" | "timed_out" | "cancelled" | "rejected";

export interface TaskSpec {
  action: "crawl_site" | "clarify" | "unsupported";
  url: string | null;
  max_pages: number;
  depth: number;
  outputs: ("summary" | "json")[];
  focus: string | null;
  interpreted_by: "llm" | "rules";
}

export interface LogEvent {
  t?: number;
  level: string;
  event: string;
  url?: string;
  parent?: string | null;
  depth?: number;
  status?: number;
  title?: string;
  words?: number;
  ms?: number;
  count?: number;
  message?: string;
  kind?: string;
  [k: string]: unknown;
}

export interface Insights {
  summary: string;
  key_points: string[];
  site_type: string;
  audience: string;
  topics: string[];
  focus_answer: string | null;
}

export interface Execution {
  tool: string;
  command: string;
  pid: number;
  exit_code: number | null;
  status: string;
  duration_ms: number;
  output_valid: boolean;
  intent_parsed_by: string;
  stderr_tail?: string[];
}

export interface FinalResult {
  state: string;
  message: string;
  error?: string | null;
  outputs?: string[];
  summary?: Insights | null;
  summary_source?: string;
  data?: Record<string, any> | null;
  execution?: Execution;
  warning?: string | null;
  guard_score?: number;
}

export interface CrawlNode {
  url: string;
  parent: string | null;
  depth: number;
  state: "fetching" | "done" | "failed" | "skipped";
  title?: string;
  status?: number;
  ms?: number;
  order: number;
}

export interface RunView {
  id: string;
  prompt: string;
  createdAt: number;
  stage: Stage;
  stageLabel: string;
  task?: TaskSpec;
  intentWarning?: string | null;
  command?: { argv: string; pid: number; timeout_s: number; why: string };
  logs: LogEvent[];
  nodes: Record<string, CrawlNode>;
  result?: FinalResult;
  ended: boolean;
  streamError?: string;
}

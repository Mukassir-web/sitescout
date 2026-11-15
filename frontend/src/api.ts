import type { RunView, LogEvent, CrawlNode } from "./types";

export async function startRun(prompt: string): Promise<string> {
  const r = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body.id as string;
}

export async function cancelRun(id: string) {
  await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
}

type Patch = (fn: (r: RunView) => RunView) => void;

/** Subscribe to a run's server-sent events and fold them into a RunView. */
export function subscribe(id: string, patch: Patch): () => void {
  const es = new EventSource(`/api/runs/${id}/events`);
  let order = 0;

  const on = (kind: string, fn: (data: any) => void) =>
    es.addEventListener(kind, (e) => fn(JSON.parse((e as MessageEvent).data).data));

  on("stage", (d) => patch((r) => ({ ...r, stage: d.state, stageLabel: d.label })));
  on("intent", (d) => patch((r) => ({ ...r, task: d.task, intentWarning: d.warning })));
  on("command", (d) => patch((r) => ({ ...r, command: d })));
  on("log", (d: LogEvent) =>
    patch((r) => {
      const nodes = { ...r.nodes };
      const url = d.url;
      if (url && d.event === "fetch_start") {
        nodes[url] = { url, parent: (d.depth ?? 0) === 0 ? null : (d.parent ?? null), depth: d.depth ?? 0, state: "fetching", order: order++ };
      } else if (url && d.event === "page_done") {
        const key = typeof d.requested === "string" && nodes[d.requested] ? d.requested : url;
        const prev: CrawlNode | undefined = nodes[key];
        nodes[key] = {
          ...(prev ?? { url: key, depth: d.depth ?? 0, order: order++, parent: d.parent ?? null }),
          parent: (d.depth ?? 0) === 0 ? null : (d.parent ?? prev?.parent ?? null),
          state: "done", title: d.title, status: d.status, ms: d.ms,
        };
      } else if (url && d.event === "page_discarded") {
        const k = Object.keys(nodes).find((u) => u === url) ?? url;
        if (nodes[k]) nodes[k] = { ...nodes[k], state: "skipped" };
      } else if (url && d.event === "fetch_failed") {
        const prev = nodes[url];
        if (prev) nodes[url] = { ...prev, state: "failed" };
        else if ((d.depth ?? 0) === 0) nodes[url] = { url, parent: null, depth: 0, state: "failed", order: order++ };
      }
      return { ...r, nodes, logs: [...r.logs, d].slice(-400) };
    }),
  );
  on("result", (d) => patch((r) => ({ ...r, result: d, stage: d.state === "clarify" || d.state === "unsupported" ? "rejected" : d.state })));
  on("error", (d) => patch((r) => ({ ...r, result: d, stage: "failed" })));
  on("end", () => {
    patch((r) => ({
      ...r,
      ended: true,
      nodes: Object.fromEntries(
        Object.entries(r.nodes).map(([k, n]) => [k, n.state === "fetching" ? { ...n, state: "skipped" as const } : n]),
      ),
    }));
    es.close();
  });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      patch((r) => (r.ended ? r : { ...r, streamError: "Lost connection to the run stream." }));
    }
  };
  return () => es.close();
}


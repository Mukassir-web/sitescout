import { useMemo, useState } from "react";
import { Check, Copy, Download } from "lucide-react";

function highlight(json: string) {
  const esc = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "json-num";
      if (m.startsWith('"')) cls = m.endsWith(":") ? "json-key" : "json-str";
      else if (m === "true" || m === "false") cls = "json-bool";
      else if (m === "null") cls = "json-null";
      return `<span class="${cls}">${m}</span>`;
    },
  );
}

export function JsonView({ data, filename }: { data: unknown; filename: string }) {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const html = useMemo(() => highlight(text), [text]);
  const [copied, setCopied] = useState(false);
  const valid = useMemo(() => { try { JSON.parse(text); return true; } catch { return false; } }, [text]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="rounded-xl bg-console text-[#D9DEE7] overflow-hidden">
      <div className="flex items-center gap-3 px-4 h-10 border-b border-white/8 text-[12.5px]">
        <span className={valid ? "text-[#8FD3A8]" : "text-[#F29C8A]"}>{valid ? "Valid JSON" : "Invalid JSON"}</span>
        <span className="text-[#8B93A1] tabular-nums">{(new Blob([text]).size / 1024).toFixed(1)} KB</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={copy} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md hover:bg-white/8 transition-colors">
            {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}
          </button>
          <button onClick={download} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md hover:bg-white/8 transition-colors">
            <Download size={14} />Download
          </button>
        </div>
      </div>
      <pre className="console-scroll max-h-[440px] overflow-auto px-4 py-3 text-[12.5px] leading-[1.6] font-mono"
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

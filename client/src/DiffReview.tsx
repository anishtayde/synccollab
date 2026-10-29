import { useState } from "react";
import { api } from "./api";

interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  oldLine: number | null;
  newLine: number | null;
}
interface DiffHunk {
  header: string;
  lines: DiffLine[];
}
interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}
interface ParseResult {
  files: DiffFile[];
  summary: { files: number; additions: number; deletions: number };
}

const BG = { add: "#e6ffec", del: "#ffebe9", context: "transparent" };
const SIGN = { add: "+", del: "-", context: " " };

export default function DiffReview({ roomId }: { roomId: string }) {
  const [diff, setDiff] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function parse(e: React.FormEvent) {
    e.preventDefault();
    if (!diff.trim()) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/rooms/${roomId}/review/parse`, {
        method: "POST",
        body: JSON.stringify({ diff }),
      });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <details style={{ margin: "8px 0 12px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Review a diff</summary>
      <form onSubmit={parse} style={{ marginTop: 8 }}>
        <textarea
          value={diff}
          onChange={(e) => setDiff(e.target.value)}
          placeholder="Paste the output of `git diff` here"
          rows={8}
          style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", padding: 6 }}
        />
        <button type="submit" disabled={loading} style={{ padding: "6px 12px" }}>
          {loading ? "Parsing..." : "Parse diff"}
        </button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 10 }}>
          <p>
            {result.summary.files} file(s), <span style={{ color: "green" }}>+{result.summary.additions}</span>{" "}
            <span style={{ color: "crimson" }}>-{result.summary.deletions}</span>
          </p>
          {result.files.map((f) => (
            <div key={f.path} style={{ border: "1px solid #ddd", borderRadius: 6, marginBottom: 10 }}>
              <div style={{ padding: "6px 8px", background: "#f4f4f4" }}>
                <strong>{f.path}</strong> <small>({f.status}) +{f.additions} -{f.deletions}</small>
              </div>
              <div style={{ maxHeight: 260, overflow: "auto" }}>
                {f.hunks.map((h, i) => (
                  <div key={i}>
                    <div style={{ padding: "2px 8px", color: "#6b7280", fontSize: 12 }}>{h.header}</div>
                    {h.lines.map((l, j) => (
                      <div
                        key={j}
                        style={{
                          background: BG[l.type],
                          color: "#1f2328",
                          fontFamily: "monospace",
                          fontSize: 12,
                          whiteSpace: "pre",
                          padding: "0 8px",
                        }}
                      >
                        <span style={{ display: "inline-block", width: 36, color: "#8b949e" }}>
                          {l.newLine ?? ""}
                        </span>
                        {SIGN[l.type]} {l.content}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
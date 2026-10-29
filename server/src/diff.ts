export type LineType = "add" | "del" | "context";

export interface DiffLine {
  type: LineType;
  content: string;
  oldLine: number | null; // line number in the old file (null for added lines)
  newLine: number | null; // line number in the new file (null for removed lines)
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

const FILE_RE = /^diff --git a\/(.+) b\/(.+)$/;
// @@ -oldStart,oldCount +newStart,newCount @@  (a missing count means 1)
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLeft = 0; // old-file lines still to read in this hunk
  let newLeft = 0; // new-file lines still to read in this hunk
  let oldNo = 0;
  let newNo = 0;

  for (const raw of text.split(/\r?\n/)) {
    // 1) inside a hunk: read exactly as many lines as the header promised
    if (hunk && file && (oldLeft > 0 || newLeft > 0)) {
      if (raw[0] === "\\") continue; // "\ No newline at end of file"
      const sign = raw[0] ?? " "; // an empty line counts as a context line
      const content = raw.slice(1);
      if (sign === "+") {
        file.additions++;
        hunk.lines.push({ type: "add", content, oldLine: null, newLine: newNo++ });
        newLeft--;
      } else if (sign === "-") {
        file.deletions++;
        hunk.lines.push({ type: "del", content, oldLine: oldNo++, newLine: null });
        oldLeft--;
      } else {
        hunk.lines.push({ type: "context", content, oldLine: oldNo++, newLine: newNo++ });
        oldLeft--;
        newLeft--;
      }
      continue;
    }

    // 2) outside a hunk: look for headers
    const fileMatch = FILE_RE.exec(raw);
    if (fileMatch) {
      file = { path: fileMatch[2], status: "modified", additions: 0, deletions: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue; // ignore anything before the first "diff --git"

    if (raw.startsWith("new file mode")) file.status = "added";
    else if (raw.startsWith("deleted file mode")) file.status = "deleted";

    const hunkMatch = HUNK_RE.exec(raw);
    if (hunkMatch) {
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      oldNo = Number(hunkMatch[1]);
      oldLeft = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      newNo = Number(hunkMatch[3]);
      newLeft = hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]);
    }
  }
  return files;
}
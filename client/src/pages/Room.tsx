import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { MonacoBinding } from "y-monaco";
import { api, clearToken, getToken } from "../api";
import { SocketProvider } from "../SocketProvider";
import { COLORS, watchCursorStyles } from "../cursors";
import DiffReview from "../DiffReview";

interface RoomData {
  id: string;
  name: string;
}

interface CommentItem {
  id: string;
  line: number;
  body: string;
  author: string;
  created_at: string;
}
interface SnippetResult {
  id: string;
  title: string;
  language: string;
  code: string;
  similarity: number;
}

type EditorType = Parameters<OnMount>[0];

const LANGUAGES = ["javascript", "typescript", "python", "java", "html", "css", "json"];

export default function Room() {
  const { id } = useParams();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("typescript");
  const [online, setOnline] = useState<string[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentText, setCommentText] = useState("");
  const [cursorLine, setCursorLine] = useState(1);
  const [editorReady, setEditorReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<SnippetResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const editorRef = useRef<EditorType | null>(null);
  const decorationsRef = useRef<ReturnType<EditorType["createDecorationsCollection"]> | null>(
    null
  );
  const navigate = useNavigate();

  // add a comment, ignoring duplicates (we may get it from both the POST and the broadcast)
  function addComment(c: CommentItem) {
    setComments((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c]));
  }

  useEffect(() => {
    api(`/rooms/${id}`)
      .then((data) => setRoom(data.room))
      .catch((err: Error) => {
        if (err.message.includes("token")) {
          clearToken();
          navigate("/login");
        } else {
          setError(err.message);
        }
      });
  }, [id, navigate]);

  useEffect(() => {
    api(`/rooms/${id}/comments`)
      .then((d) => setComments(d.comments))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  useEffect(() => {
    const load = () =>
      api(`/rooms/${id}/presence`)
        .then((d) => setOnline(d.online))
        .catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [id]);

  // draw a yellow marker next to every line that has a comment
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !editorReady) return;
    if (!decorationsRef.current) decorationsRef.current = editor.createDecorationsCollection();
    const lines = [...new Set(comments.map((c) => c.line))];
    decorationsRef.current.set(
      lines.map((l) => ({
        range: { startLineNumber: l, startColumn: 1, endLineNumber: l, endColumn: 1 },
        options: { glyphMarginClassName: "comment-glyph" },
      }))
    );
  }, [comments, editorReady]);

  const handleMount: OnMount = (editor) => {
    cleanupRef.current?.();
    editorRef.current = editor;
    decorationsRef.current = null;
    setEditorReady(true);

    editor.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber));

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const color = COLORS[doc.clientID % COLORS.length];

    awareness.setLocalStateField("user", { name: "Guest", color });
    api("/auth/me")
      .then((data) => {
        const name = (data.user.email as string).split("@")[0];
        awareness.setLocalStateField("user", { name, color });
      })
      .catch(() => {});

    const stopStyles = watchCursorStyles(awareness);
    const provider = new SocketProvider(
      `ws://localhost:4000/ws?room=${id}&token=${getToken()}`,
      doc,
      awareness,
      (msg) => {
        if (msg.type === "comment") addComment(msg.comment);
      }
    );
    const binding = new MonacoBinding(
      doc.getText("code"),
      editor.getModel()!,
      new Set([editor]),
      awareness
    );

    cleanupRef.current = () => {
      binding.destroy();
      provider.destroy();
      stopStyles();
      awareness.destroy();
      doc.destroy();
    };
  };

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    try {
      const data = await api(`/rooms/${id}/comments`, {
        method: "POST",
        body: JSON.stringify({ line: cursorLine, body: commentText }),
      });
      addComment(data.comment);
      setCommentText("");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  
    async function saveSnippet() {
    const code = editorRef.current?.getValue() ?? "";
    if (!code.trim()) {
      setNotice("Write some code first");
      return;
    }
    const title = window.prompt("Snippet title?");
    if (!title || !title.trim()) return;
    setNotice("Saving...");
    try {
      await api(`/rooms/${id}/snippets`, {
        method: "POST",
        body: JSON.stringify({ title, language, code }),
      });
      setNotice("Snippet saved!");
    } catch (err) {
      setNotice((err as Error).message);
    }
  }
    async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchText.trim()) return;
    setSearching(true);
    setNotice("");
    try {
      const data = await api(`/rooms/${id}/snippets/search?q=${encodeURIComponent(searchText)}`);
      setResults(data.results);
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  // put a snippet's code into the editor at the cursor
  function insertSnippet(code: string) {
    const editor = editorRef.current;
    const pos = editor?.getPosition();
    if (!editor || !pos) return;
    editor.executeEdits("snippet-insert", [
      {
        range: {
          startLineNumber: pos.lineNumber,
          startColumn: pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column,
        },
        text: code + "\n",
      },
    ]);
    editor.focus();
  }
  
  
  function jumpToLine(line: number) {
    editorRef.current?.revealLineInCenter(line);
    editorRef.current?.setPosition({ lineNumber: line, column: 1 });
    editorRef.current?.focus();
  }

  return (
    <div style={{ maxWidth: 1200, margin: "30px auto", fontFamily: "sans-serif" }}>
      <Link to="/">← Back to rooms</Link>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {room && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>{room.name}</h2>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {notice && <small>{notice}</small>}
              <button onClick={saveSnippet}>Save as snippet</button>
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p style={{ margin: "0 0 8px" }}>
            Online: {online.length === 0 ? "-" : online.join(", ")}
          </p>
          <DiffReview roomId={id!} />
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Editor
                height="65vh"
                theme="vs-dark"
                language={language}
                defaultValue=""
                onMount={handleMount}
                options={{ fontSize: 14, minimap: { enabled: false }, glyphMargin: true }}
              />
            </div>
            <div style={{ width: 300, display: "flex", flexDirection: "column" }}>
                            <h3 style={{ margin: "0 0 8px" }}>Search snippets</h3>
              <form onSubmit={runSearch} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="e.g. check user credentials"
                  maxLength={300}
                  style={{ flex: 1, padding: 6 }}
                />
                <button type="submit" disabled={searching}>
                  {searching ? "..." : "Search"}
                </button>
              </form>
              {results && (
                <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
                  {results.length === 0 && <p>No snippets saved in this room yet.</p>}
                  {results.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 6,
                        padding: 8,
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <strong>{r.title}</strong>
                        <small>{Math.round(r.similarity * 100)}% match</small>
                      </div>
                      <small>{r.language}</small>
                      <pre
                        style={{
                          margin: "6px 0",
                          maxHeight: 70,
                          overflow: "hidden",
                          fontSize: 12,
                          background: "#f4f4f4",
                          padding: 6,
                        }}
                      >
                        {r.code}
                      </pre>
                      <button onClick={() => insertSnippet(r.code)} style={{ width: "100%" }}>
                        Insert at cursor
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <h3 style={{ margin: "0 0 8px" }}>Comments</h3>
              <div style={{ flex: 1, overflowY: "auto", maxHeight: "50vh" }}>
                {comments.length === 0 && <p>No comments yet.</p>}
                {comments.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => jumpToLine(c.line)}
                    style={{
                      cursor: "pointer",
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      padding: 8,
                      marginBottom: 8,
                    }}
                  >
                    <small>
                      Line {c.line} · {c.author.split("@")[0]}
                    </small>
                    <div>{c.body}</div>
                  </div>
                ))}
              </div>
              <form onSubmit={postComment} style={{ marginTop: 8 }}>
                <small>Comment on line {cursorLine}</small>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  maxLength={500}
                  rows={3}
                  style={{ width: "100%", boxSizing: "border-box", padding: 6 }}
                />
                <button type="submit" style={{ width: "100%", padding: 8 }}>
                  Add comment
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
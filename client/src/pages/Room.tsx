import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { MonacoBinding } from "y-monaco";
import { api, clearToken, getToken } from "../api";
import { SocketProvider } from "../SocketProvider";
import { COLORS, watchCursorStyles } from "../cursors";

interface RoomData {
  id: string;
  name: string;
}

const LANGUAGES = ["javascript", "typescript", "python", "java", "html", "css", "json"];

export default function Room() {
  const { id } = useParams();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("typescript");
  const cleanupRef = useRef<(() => void) | null>(null);
  const navigate = useNavigate();

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
    return () => cleanupRef.current?.();
  }, []);

  const handleMount: OnMount = (editor) => {
    cleanupRef.current?.();

    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const color = COLORS[doc.clientID % COLORS.length];

    // start with a placeholder name, then replace it with the real one
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
      awareness
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

  return (
    <div style={{ maxWidth: 1000, margin: "30px auto", fontFamily: "sans-serif" }}>
      <Link to="/">← Back to rooms</Link>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {room && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>{room.name}</h2>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <Editor
            height="65vh"
            theme="vs-dark"
            language={language}
            defaultValue=""
            onMount={handleMount}
            options={{ fontSize: 14, minimap: { enabled: false } }}
          />
        </>
      )}
    </div>
  );
}
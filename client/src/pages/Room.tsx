import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import { api, clearToken, getToken } from "../api";
import { SocketProvider } from "../SocketProvider";

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

  // disconnect when leaving the page
  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  const handleMount: OnMount = (editor) => {
    cleanupRef.current?.(); // safety: never keep two connections

    const doc = new Y.Doc();
    const provider = new SocketProvider(
      `ws://localhost:4000/ws?room=${id}&token=${getToken()}`,
      doc
    );
    const binding = new MonacoBinding(
      doc.getText("code"),
      editor.getModel()!,
      new Set([editor])
    );

    cleanupRef.current = () => {
      binding.destroy();
      provider.destroy();
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
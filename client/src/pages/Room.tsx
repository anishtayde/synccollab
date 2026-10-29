import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { api, clearToken } from "../api";

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
  const [code, setCode] = useState("// Start typing here\n");
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
            value={code}
            onChange={(value) => setCode(value ?? "")}
            options={{ fontSize: 14, minimap: { enabled: false } }}
          />
        </>
      )}
    </div>
  );
}
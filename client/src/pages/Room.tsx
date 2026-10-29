import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, clearToken } from "../api";

interface RoomData {
  id: string;
  name: string;
}

export default function Room() {
  const { id } = useParams();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState("");
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
    <div style={{ maxWidth: 800, margin: "40px auto", fontFamily: "sans-serif" }}>
      <Link to="/">← Back to rooms</Link>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {room && (
        <>
          <h2>{room.name}</h2>
          <p>The code editor will appear here soon.</p>
        </>
      )}
    </div>
  );
}
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { api, clearToken } from "../api";

interface RoomItem {
  id: string;
  name: string;
}

export default function Home() {
  const [email, setEmail] = useState("");
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api("/auth/me")
      .then((data) => setEmail(data.user.email))
      .catch(() => {
        clearToken();
        navigate("/login");
      });
    api("/rooms")
      .then((data) => setRooms(data.rooms))
      .catch(() => {});
  }, [navigate]);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const data = await api("/rooms", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setRooms([data.room, ...rooms]);
      setName("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function logout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div style={{ maxWidth: 600, margin: "60px auto", fontFamily: "sans-serif" }}>
      <h2>Welcome, {email}</h2>
      <button onClick={logout}>Log out</button>

      <h3 style={{ marginTop: 30 }}>Create a room</h3>
      <form onSubmit={createRoom}>
        <input
          placeholder="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8, marginRight: 8 }}
        />
        <button type="submit" style={{ padding: 8 }}>Create</button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}

      <h3 style={{ marginTop: 30 }}>Your rooms</h3>
      {rooms.length === 0 && <p>No rooms yet.</p>}
      <ul>
        {rooms.map((r) => (
          <li key={r.id}>
            <Link to={`/room/${r.id}`}>{r.name}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
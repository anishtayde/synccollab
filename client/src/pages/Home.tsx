import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken } from "../api";

export default function Home() {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api("/auth/me")
      .then((data) => setEmail(data.user.email))
      .catch(() => {
        clearToken();
        navigate("/login");
      });
  }, [navigate]);

  function logout() {
    clearToken();
    navigate("/login");
  }

  return (
    <div style={{ maxWidth: 600, margin: "80px auto", fontFamily: "sans-serif" }}>
      <h2>Welcome, {email}</h2>
      <p>Rooms will appear here soon.</p>
      <button onClick={logout}>Log out</button>
    </div>
  );
}
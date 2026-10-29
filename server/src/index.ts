import http from "http";
import { setupWebSocket } from "./ws";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db";
import authRouter from "./routes/auth";
import roomsRouter from "./routes/rooms";
import { redis } from "./redis";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/auth", authRouter);
app.use("/rooms", roomsRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/health/db", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", time: result.rows[0].now });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error" });
  }
});
async function clearPresence() {
  const keys = await redis.keys("presence:*");
  if (keys.length > 0) await redis.del(...keys);
}
clearPresence().catch((err) => console.error(err));
const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
setupWebSocket(server);
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
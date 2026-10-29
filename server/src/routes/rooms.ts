import { broadcastToRoom } from "../ws";
import { redis } from "../redis";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { embedText, toVectorLiteral } from "../embeddings";

const router = Router();
const CACHE_ENABLED = process.env.CACHE_ENABLED !== "false";
const ROOM_TTL_SECONDS = 60;
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

router.post("/", async (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Room name (1-60 chars) required" });
    return;
  }
  try {
    const result = await pool.query(
      "INSERT INTO rooms (name, owner_id) VALUES ($1, $2) RETURNING id, name, owner_id, created_at",
      [parsed.data.name, req.userId]
    );
    res.status(201).json({ room: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/", async (req: AuthRequest, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, owner_id, created_at FROM rooms WHERE owner_id = $1 ORDER BY created_at DESC",
      [req.userId]
    );
    res.json({ rooms: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  const idCheck = z.string().uuid().safeParse(req.params.id);
  if (!idCheck.success) {
    res.status(400).json({ error: "Invalid room id" });
    return;
  }
  const key = `room:${idCheck.data}`;
  try {
    // 1. try the cache first
    if (CACHE_ENABLED) {
      const cached = await redis.get(key);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json({ room: JSON.parse(cached) });
        return;
      }
    }

    // 2. cache miss: read Postgres
    const result = await pool.query(
      "SELECT id, name, owner_id, created_at FROM rooms WHERE id = $1",
      [idCheck.data]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    const room = result.rows[0];

    // 3. save it in Redis for next time (expires after 60 seconds)
    if (CACHE_ENABLED) {
      await redis.set(key, JSON.stringify(room), "EX", ROOM_TTL_SECONDS);
    }
    res.setHeader("X-Cache", "MISS");
    res.json({ room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
router.get("/:id/presence", async (req: AuthRequest, res) => {
  const idCheck = z.string().uuid().safeParse(req.params.id);
  if (!idCheck.success) {
    res.status(400).json({ error: "Invalid room id" });
    return;
  }
  try {
    const online = await redis.hkeys(`presence:${idCheck.data}`);
    res.json({ online });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const commentSchema = z.object({
  line: z.number().int().min(1),
  body: z.string().trim().min(1).max(500),
});

router.get("/:id/comments", async (req: AuthRequest, res) => {
  const idCheck = z.string().uuid().safeParse(req.params.id);
  if (!idCheck.success) {
    res.status(400).json({ error: "Invalid room id" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT c.id, c.line, c.body, c.created_at, u.email AS author
       FROM comments c JOIN users u ON u.id = c.user_id
       WHERE c.room_id = $1 ORDER BY c.created_at`,
      [idCheck.data]
    );
    res.json({ comments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/comments", async (req: AuthRequest, res) => {
  const idCheck = z.string().uuid().safeParse(req.params.id);
  const parsed = commentSchema.safeParse(req.body);
  if (!idCheck.success || !parsed.success) {
    res.status(400).json({ error: "Line number and comment (1-500 chars) required" });
    return;
  }
  try {
    const result = await pool.query(
      `WITH ins AS (
         INSERT INTO comments (room_id, user_id, line, body)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, line, body, created_at
       )
       SELECT ins.id, ins.line, ins.body, ins.created_at, u.email AS author
       FROM ins JOIN users u ON u.id = ins.user_id`,
      [idCheck.data, req.userId, parsed.data.line, parsed.data.body]
    );
    const comment = result.rows[0];
    broadcastToRoom(idCheck.data, { type: "comment", comment });
    res.status(201).json({ comment });
  } catch (err: any) {
    if (err.code === "23503") {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

const snippetSchema = z.object({
  title: z.string().trim().min(1).max(100),
  language: z.string().trim().min(1).max(30),
  code: z.string().min(1).max(20000),
});

router.post("/:id/snippets", async (req: AuthRequest, res) => {
  const idCheck = z.string().uuid().safeParse(req.params.id);
  const parsed = snippetSchema.safeParse(req.body);
  if (!idCheck.success || !parsed.success) {
    res.status(400).json({ error: "Title (1-100), language and code (max 20000 chars) required" });
    return;
  }
  const { title, language, code } = parsed.data;

  // 1) ask Gemini for the embedding
  let vector: number[];
  try {
    vector = await embedText(`${title}\n${language}\n${code}`, "RETRIEVAL_DOCUMENT");
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "Embedding service failed, try again" });
    return;
  }

  // 2) store code + embedding together
  try {
    const result = await pool.query(
      `INSERT INTO snippets (room_id, user_id, title, language, code, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       RETURNING id, title, language, created_at`,
      [idCheck.data, req.userId, title, language, code, toVectorLiteral(vector)]
    );
    res.status(201).json({ snippet: result.rows[0] });
  } catch (err: any) {
    if (err.code === "23503") {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
export default router;
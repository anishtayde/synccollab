import { redis } from "../redis";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, AuthRequest } from "../middleware/auth";

const router = Router();
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
  try {
    const result = await pool.query(
      "SELECT id, name, owner_id, created_at FROM rooms WHERE id = $1",
      [idCheck.data]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Room not found" });
      return;
    }
    res.json({ room: result.rows[0] });
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
export default router;
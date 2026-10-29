import { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "./db";
import { redis } from "./redis";

// roomId -> set of connected sockets (used to forward messages)
const rooms = new Map<string, Set<WebSocket>>();

async function addPresence(roomId: string, email: string) {
  await redis.hincrby(`presence:${roomId}`, email, 1);
}

async function removePresence(roomId: string, email: string) {
  const left = await redis.hincrby(`presence:${roomId}`, email, -1);
  if (left <= 0) await redis.hdel(`presence:${roomId}`, email);
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const roomId = url.searchParams.get("room");
    const token = url.searchParams.get("token");

    // 1. validate room id
    const roomCheck = z.string().uuid().safeParse(roomId);
    if (!roomCheck.success) {
      socket.close(4400, "Invalid room");
      return;
    }

    // 2. validate token and remember who this is
    let userId: string;
    try {
      const payload = jwt.verify(token ?? "", process.env.JWT_SECRET as string) as {
        userId: string;
      };
      userId = payload.userId;
    } catch {
      socket.close(4401, "Unauthorized");
      return;
    }

    // 3. join the room (message forwarding)
    const id = roomCheck.data;
    if (!rooms.has(id)) rooms.set(id, new Set());
    rooms.get(id)!.add(socket);
    console.log(`WS: client joined ${id} (${rooms.get(id)!.size} in room)`);

    // 4. register presence in Redis (runs in the background)
    const joined = pool
      .query("SELECT email FROM users WHERE id = $1", [userId])
      .then(async (r) => {
        const email = r.rows[0]?.email as string | undefined;
        if (!email) return null;
        await addPresence(id, email);
        return email;
      })
      .catch((err) => {
        console.error(err);
        return null;
      });

    // 5. forward messages to everyone else in the room
    socket.on("message", (data, isBinary) => {
      for (const client of rooms.get(id) ?? []) {
        if (client !== socket && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      }
    });

    // 6. clean up when they leave
    socket.on("close", () => {
      const set = rooms.get(id);
      if (set) {
        set.delete(socket);
        if (set.size === 0) rooms.delete(id);
      }
      joined
        .then((email) => (email ? removePresence(id, email) : undefined))
        .catch((err) => console.error(err));
      console.log(`WS: client left ${id}`);
    });
  });
}
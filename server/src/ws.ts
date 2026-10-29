import { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { z } from "zod";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { pool } from "./db";
import { redis } from "./redis";

const MESSAGE_SYNC = 0;
const SAVE_DELAY_MS = 2000;

// roomId -> set of connected sockets (used to forward messages)
const rooms = new Map<string, Set<WebSocket>>();

// send a JSON message to everyone connected to a room
export function broadcastToRoom(roomId: string, payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const client of rooms.get(roomId) ?? []) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// roomId -> the server's own copy of the Yjs document
interface RoomDoc {
  doc: Y.Doc;
  ready: Promise<void>; // resolves once the saved state is loaded
  timer: NodeJS.Timeout | null; // pending debounced save
}
const docs = new Map<string, RoomDoc>();

async function saveDoc(roomId: string, doc: Y.Doc) {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  await pool.query(
    `INSERT INTO room_documents (room_id, state, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (room_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
    [roomId, state]
  );
}

function getRoomDoc(roomId: string): RoomDoc {
  const existing = docs.get(roomId);
  if (existing) return existing;

  const doc = new Y.Doc();
  const entry: RoomDoc = { doc, ready: Promise.resolve(), timer: null };

  entry.ready = pool
    .query("SELECT state FROM room_documents WHERE room_id = $1", [roomId])
    .then((result) => {
      if (result.rows[0]) {
        Y.applyUpdate(doc, new Uint8Array(result.rows[0].state));
      }
      // only start watching for changes AFTER loading, so loading doesn't trigger a save
      doc.on("update", () => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          saveDoc(roomId, doc).catch((err) => console.error("Save failed:", err));
        }, SAVE_DELAY_MS);
      });
    });

  docs.set(roomId, entry);
  return entry;
}

// called when the last user leaves a room
async function flushRoom(roomId: string) {
  const entry = docs.get(roomId);
  if (!entry) return;
  try {
    await entry.ready;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
      await saveDoc(roomId, entry.doc);
    }
  } catch (err) {
    console.error("Flush failed:", err);
  }
  // free memory, unless someone joined while we were saving
  if (!rooms.has(roomId)) {
    entry.doc.destroy();
    docs.delete(roomId);
  }
}

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

    // 3. join the room
    const id = roomCheck.data;
    if (!rooms.has(id)) rooms.set(id, new Set());
    rooms.get(id)!.add(socket);
    console.log(`WS: client joined ${id} (${rooms.get(id)!.size} in room)`);

    // 4. get (or load) the server's copy of this room's document
    const entry = getRoomDoc(id);
    entry.ready.catch((err) => {
      console.error("Load failed:", err);
      socket.close(1011, "Could not load document");
    });

    // 5. register presence in Redis (runs in the background)
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

    // 6. handle messages: apply to our copy, answer sync requests, forward to others
    socket.on("message", (data, isBinary) => {
      entry.ready
        .then(() => {
          if (isBinary) {
            const decoder = decoding.createDecoder(new Uint8Array(data as Buffer));
            if (decoding.readVarUint(decoder) === MESSAGE_SYNC) {
              const reply = encoding.createEncoder();
              encoding.writeVarUint(reply, MESSAGE_SYNC);
              syncProtocol.readSyncMessage(decoder, reply, entry.doc, null);
              // a sync step 1 from a new client: answer with what we have
              if (encoding.length(reply) > 1 && socket.readyState === WebSocket.OPEN) {
                socket.send(encoding.toUint8Array(reply));
              }
            }
          }
          for (const client of rooms.get(id) ?? []) {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(data, { binary: isBinary });
            }
          }
        })
        .catch((err) => console.error("Message error:", err));
    });

    // 7. clean up when they leave
    socket.on("close", () => {
      const set = rooms.get(id);
      if (set) {
        set.delete(socket);
        if (set.size === 0) {
          rooms.delete(id);
          flushRoom(id);
        }
      }
      joined
        .then((email) => (email ? removePresence(id, email) : undefined))
        .catch((err) => console.error(err));
      console.log(`WS: client left ${id}`);
    });
  });
}
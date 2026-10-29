import { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { z } from "zod";

// roomId -> set of connected sockets
const rooms = new Map<string, Set<WebSocket>>();

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

    // 2. validate token
    try {
      jwt.verify(token ?? "", process.env.JWT_SECRET as string);
    } catch {
      socket.close(4401, "Unauthorized");
      return;
    }

    // 3. join the room
    const id = roomCheck.data;
    if (!rooms.has(id)) rooms.set(id, new Set());
    rooms.get(id)!.add(socket);
    console.log(`WS: client joined ${id} (${rooms.get(id)!.size} in room)`);

    // 4. forward messages to everyone else in the room
    socket.on("message", (data, isBinary) => {
      for (const client of rooms.get(id) ?? []) {
        if (client !== socket && client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      }
    });

    // 5. clean up when they leave
    socket.on("close", () => {
      const set = rooms.get(id);
      if (!set) return;
      set.delete(socket);
      if (set.size === 0) rooms.delete(id);
      console.log(`WS: client left ${id}`);
    });
  });
}
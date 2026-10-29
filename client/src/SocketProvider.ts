import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export class SocketProvider {
  private ws: WebSocket;

  constructor(
    url: string,
    private doc: Y.Doc,
    private awareness: awarenessProtocol.Awareness
  ) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      // ask the others for their document state (sync step 1)
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc);
      this.ws.send(encoding.toUint8Array(enc));
      // tell the others about our cursor/name
      this.sendAwareness([this.doc.clientID]);
    };

    this.ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const type = decoding.readVarUint(decoder);

      if (type === MESSAGE_SYNC) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
        if (encoding.length(reply) > 1) {
          this.ws.send(encoding.toUint8Array(reply));
          // a step 1 means someone just joined: introduce ourselves to them
          this.sendAwareness([this.doc.clientID]);
        }
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this
        );
      }
    };

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
  }

  private sendAwareness(clients: number[]) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients)
    );
    this.ws.send(encoding.toUint8Array(enc));
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    if (origin === this) return; // came from the network, don't echo it
    this.sendAwareness(added.concat(updated, removed));
  };

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.ws.send(encoding.toUint8Array(enc));
  };

  destroy() {
    // tell the others we left, so our cursor disappears right away
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], "left");
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.ws.close();
  }
}
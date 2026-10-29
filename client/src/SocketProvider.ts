import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const MESSAGE_SYNC = 0;

export class SocketProvider {
  private ws: WebSocket;

  constructor(url: string, private doc: Y.Doc) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    // when the connection opens, ask the others for their state (sync step 1)
    this.ws.onopen = () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, this.doc);
      this.ws.send(encoding.toUint8Array(enc));
    };

    // when a message arrives, apply it to our document
    this.ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data));
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
        // if the message needs an answer (e.g. step 1), send it
        if (encoding.length(reply) > 1) {
          this.ws.send(encoding.toUint8Array(reply));
        }
      }
    };

    // when WE change the document, send the update to the others
    this.doc.on("update", this.onDocUpdate);
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // came from the network, don't echo it back
    if (this.ws.readyState !== WebSocket.OPEN) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    this.ws.send(encoding.toUint8Array(enc));
  };

  destroy() {
    this.doc.off("update", this.onDocUpdate);
    this.ws.close();
  }
}
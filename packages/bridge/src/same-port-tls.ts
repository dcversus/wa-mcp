import type { Server } from "node:http";
import type { Socket } from "node:net";
import { createServer as createTlsServer } from "node:tls";

/** a client that connected but hasn't said anything yet */
const SNIFF_TIMEOUT_MS = 10_000;
/** the first byte of every TLS record carrying a handshake */
const TLS_HANDSHAKE = 0x16;

export interface SamePortTls {
  cert: string;
  key: string;
  sniffTimeoutMs?: number;
}

/** Serves TLS and plain HTTP on the server's one port: the first byte of a
 * connection says which it is. Both end up at the same request handler, so the
 * web UI, the CLI and health checks keep using http:// while MCP hosts use
 * https:// on the same address (ADR 0013). */
export function acceptTlsOnSamePort(server: Server, options: SamePortTls): void {
  const tlsServer = createTlsServer({
    cert: options.cert,
    key: options.key,
    ALPNProtocols: ["http/1.1"],
  });
  const httpListeners = server.listeners("connection") as Array<(socket: Socket) => void>;
  server.removeAllListeners("connection");
  const serveHttp = (socket: Socket): void => {
    for (const listener of httpListeners) {
      listener.call(server, socket);
    }
  };
  tlsServer.on("secureConnection", serveHttp);
  tlsServer.on("tlsClientError", (_err, socket) => {
    socket.destroy();
  });
  server.on("connection", (socket: Socket) => {
    // until a handler owns the socket a reset would be an unhandled error
    const ignoreError = (): void => {};
    socket.on("error", ignoreError);
    const timer = setTimeout(() => {
      socket.destroy();
    }, options.sniffTimeoutMs ?? SNIFF_TIMEOUT_MS);
    timer.unref();
    socket.once("close", () => {
      clearTimeout(timer);
    });
    const sniff = (): void => {
      const first = socket.read(1) as Buffer | null;
      if (first === null) {
        socket.once("readable", sniff);
        return;
      }
      clearTimeout(timer);
      socket.off("error", ignoreError);
      socket.unshift(first);
      if (first[0] === TLS_HANDSHAKE) {
        // http.Server sockets are half-open and the TLS socket inherits that:
        // a client leaving before its first request would never be closed
        socket.allowHalfOpen = false;
        tlsServer.emit("connection", socket);
      } else {
        serveHttp(socket);
      }
    };
    socket.once("readable", sniff);
  });
}

import { downloadMediaMessage } from "baileys";
import type { WAMessage, WASocket } from "baileys";
import pino from "pino";
import { extractContent } from "../ingest/extract.ts";
import type { Store } from "../store/schema.ts";
import { MediaError, saveOutboundMedia, sniffMimeType } from "./resolve.ts";

const LOGGER = pino({ level: "silent" });
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export interface DownloadResult {
  path: string;
  mime: string;
  size: number;
}

export interface DownloadOptions {
  store: Store;
  mediaDir: string;
  messageId: string;
}

export async function downloadMessageMedia(
  socket: WASocket,
  message: WAMessage,
  opts: DownloadOptions,
): Promise<DownloadResult> {
  if (!SAFE_ID.test(opts.messageId)) {
    throw new MediaError(
      "PATH_FORBIDDEN",
      `message id may only contain letters, digits, _ and -: ${opts.messageId}`,
    );
  }
  let buffer: Buffer;
  try {
    buffer = await downloadMediaMessage(
      message,
      "buffer",
      {
        host: undefined,
      },
      {
        reuploadRequest: async (msg: WAMessage) =>
          (await socket.updateMediaMessage(msg)) as WAMessage,
        logger: LOGGER,
      },
    );
  } catch (err) {
    throw new MediaError(
      "EMPTY",
      err instanceof Error ? err.message : "message has no downloadable media",
    );
  }
  if (buffer.length === 0) {
    throw new MediaError("EMPTY", "downloaded media is empty");
  }
  const mime = sniffMimeType(buffer);
  const mediaType = extractContent(message).mediaType ?? "document";
  const path = await saveOutboundMedia(
    opts.store,
    opts.mediaDir,
    opts.messageId,
    buffer,
    mime,
    mediaType,
  );
  return { path, mime, size: buffer.length };
}

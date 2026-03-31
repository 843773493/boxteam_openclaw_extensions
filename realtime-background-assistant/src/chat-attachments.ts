import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
};

export type ChatAttachmentMedia = {
  path: string;
  mimeType: string;
  bytes: number;
};

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xbm": "image/x-xbitmap",
  ".xpm": "image/x-xpixmap",
};

const MIME_TO_EXT: Record<string, string> = {
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/x-xbitmap": ".xbm",
  "image/x-xpixmap": ".xpm",
};

function normalizeMimeType(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.split(";")[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function stripDataUrlPrefix(value: string): string {
  const match = /^data:[^;]+;base64,(.*)$/s.exec(value.trim());
  return match?.[1] ?? value.trim();
}

function isValidBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function sanitizeFileName(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return safe || "attachment";
}

function resolveImageMimeType(attachment: ChatAttachment, index: number): string {
  const providedMime = normalizeMimeType(attachment.mimeType);
  if (providedMime?.startsWith("image/")) {
    return providedMime;
  }

  const ext = path.extname(attachment.fileName ?? "").toLowerCase();
  const inferredMime = ext ? IMAGE_EXT_TO_MIME[ext] : undefined;
  if (inferredMime) {
    return inferredMime;
  }

  throw new Error(`attachment ${attachment.fileName?.trim() || index + 1}: mimeType must be image/*`);
}

function resolveFileName(attachment: ChatAttachment, index: number, mimeType: string): string {
  const providedName = attachment.fileName?.trim();
  if (providedName) {
    const parsed = path.parse(providedName);
    const safeBase = sanitizeFileName(parsed.name);
    if (parsed.ext) {
      return `${safeBase}${parsed.ext}`;
    }
    return `${safeBase}${MIME_TO_EXT[mimeType] ?? ".png"}`;
  }

  return `attachment-${index + 1}${MIME_TO_EXT[mimeType] ?? ".png"}`;
}

function getAttachmentLabel(attachment: ChatAttachment, index: number): string {
  return attachment.fileName?.trim() || attachment.type?.trim() || `attachment-${index + 1}`;
}

async function resolveUploadDir(baseDir?: string): Promise<string> {
  return baseDir ?? path.join(os.tmpdir(), "realtime-background-assistant", "uploads");
}

export async function parseImageAttachments(params: {
  attachments?: ChatAttachment[];
  maxBytes?: number;
  baseDir?: string;
}): Promise<ChatAttachmentMedia[]> {
  const attachments = params.attachments ?? [];
  if (attachments.length === 0) {
    return [];
  }

  const maxBytes = params.maxBytes ?? 10_000_000;
  const uploadDir = await resolveUploadDir(params.baseDir);
  await fs.mkdir(uploadDir, { recursive: true });

  const media: ChatAttachmentMedia[] = [];
  for (const [index, attachment] of attachments.entries()) {
    if (!attachment) {
      continue;
    }

    const label = getAttachmentLabel(attachment, index);
    if (typeof attachment.content !== "string") {
      throw new Error(`attachment ${label}: content must be a base64 string`);
    }

    const mimeType = resolveImageMimeType(attachment, index);
    const base64 = stripDataUrlPrefix(attachment.content);
    if (!isValidBase64(base64)) {
      throw new Error(`attachment ${label}: invalid base64 content`);
    }

    const bytes = Buffer.byteLength(base64, "base64");
    if (bytes <= 0 || bytes > maxBytes) {
      throw new Error(`attachment ${label}: exceeds size limit (${bytes} > ${maxBytes} bytes)`);
    }

    const buffer = Buffer.from(base64, "base64");
    const fileName = resolveFileName(attachment, index, mimeType);
    const filePath = path.join(uploadDir, `${Date.now()}-${crypto.randomUUID()}-${fileName}`);
    await fs.writeFile(filePath, buffer);

    media.push({
      path: filePath,
      mimeType,
      bytes,
    });
  }

  return media;
}
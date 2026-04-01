import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseImageAttachments, type ChatAttachment } from "./chat-attachments.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("parseImageAttachments", () => {
  it("writes uploaded images into temp files", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "realtime-background-assistant-test-"));
    const attachments: ChatAttachment[] = [
      {
        type: "image",
        mimeType: "image/png",
        fileName: "first.png",
        content: `data:image/png;base64,${PNG_1X1}`,
      },
      {
        type: "image",
        mimeType: "image/png",
        fileName: "second.png",
        content: PNG_1X1,
      },
    ];

    const media = await parseImageAttachments({ attachments, baseDir: tempDir });

    expect(media).toHaveLength(2);
    expect(media[0]?.mimeType).toBe("image/png");
    expect(media[1]?.mimeType).toBe("image/png");
    expect(media[0]?.data).toBe(PNG_1X1);
    expect(media[1]?.data).toBe(PNG_1X1);
    await expect(fs.readFile(media[0]!.path)).resolves.toEqual(Buffer.from(PNG_1X1, "base64"));
    await expect(fs.readFile(media[1]!.path)).resolves.toEqual(Buffer.from(PNG_1X1, "base64"));
  });

  it("rejects non-image attachments", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "realtime-background-assistant-test-"));
    const attachments: ChatAttachment[] = [
      {
        type: "file",
        mimeType: "application/pdf",
        fileName: "doc.pdf",
        content: PNG_1X1,
      },
    ];

    await expect(parseImageAttachments({ attachments, baseDir: tempDir })).rejects.toThrow(
      /mimeType must be image\//i,
    );
  });
});
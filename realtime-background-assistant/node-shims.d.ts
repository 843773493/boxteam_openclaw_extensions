declare namespace NodeJS {
  type Platform = "darwin" | "linux" | "win32" | string;
}

declare class Buffer {
  readonly byteLength: number;
  toString(encoding?: string): string;
  static isBuffer(value: unknown): value is Buffer;
  static from(value: string, encoding?: string): Buffer;
  static from(arrayBuffer: ArrayBufferLike, byteOffset?: number, length?: number): Buffer;
  static from(value: Uint8Array): Buffer;
  static concat(buffers: Buffer[]): Buffer;
  static byteLength(value: string, encoding?: string): number;
}

declare module "node:http" {
  export type IncomingMessage = {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
    on(event: "end", listener: () => void): void;
    on(event: "error", listener: (error: unknown) => void): void;
    destroy(): void;
    method?: string;
    url?: string;
  };

  export type ServerResponse = {
    statusCode: number;
    headersSent?: boolean;
    setHeader(name: string, value: string | number): void;
    end(data?: string): void;
    writeHead(statusCode: number, headers?: Record<string, string>): void;
  };

  export type Server = {
    once(event: "error", listener: (error: unknown) => void): void;
    listen(port: number, host: string, callback: () => void): void;
    address(): { address: string; port: number } | string | null;
    close(callback: () => void): void;
  };

  const http: {
    createServer(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): Server;
  };

  export default http;
}

declare module "node:crypto" {
  export function randomUUID(): string;

  const crypto: {
    randomUUID(): string;
  };

  export default crypto;
}

declare module "node:fs" {
  const fs: {
    appendFileSync(path: string, data: string, options?: string | { encoding?: string }): void;
    mkdirSync(path: string, options?: { recursive?: boolean }): void;
  };

  export default fs;
}

declare module "node:fs/promises" {
  const fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    readFile(path: string): Promise<Uint8Array>;
    writeFile(path: string, data: string | Buffer | Uint8Array, options?: { encoding?: string }): Promise<void>;
    rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
    copyFile(src: string, dest: string): Promise<void>;
  };

  export default fs;
}

declare module "node:os" {
  const os: {
    homedir(): string;
    tmpdir(): string;
  };

  export default os;
}

declare module "node:path" {
  type ParsedPath = {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  };

  const path: {
    dirname(path: string): string;
    join(...parts: string[]): string;
    parse(path: string): ParsedPath;
    resolve(...parts: string[]): string;
    extname(path: string): string;
  };

  export default path;
}

declare module "node:process" {
  const process: {
    env: Record<string, string | undefined>;
    platform: NodeJS.Platform;
  };

  export default process;
}
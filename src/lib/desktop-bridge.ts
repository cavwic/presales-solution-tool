import type { DirectoryHandleLike, WorkspaceFileFingerprint } from "./workspace-io";
import type { ModelSettings, ModelChannel, ModelTask, LocalModelRuntime } from "./model-settings";
import type { ImportedSkillsApi } from "./imported-skills";

export type ModelCatalog = { models: { model: string; displayName: string; isDefault?: boolean; inputModalities?: string[] }[]; defaultModel: string; clientVersion?: string | null; clientCommand?: string; manualRequired?: boolean };
export type ModelChatResult = { content: string; provider: ModelChannel; model: string };
export type LocalModelCatalog = { models: { model: string; displayName: string }[]; runtime: LocalModelRuntime; endpoint: string };

export type NativeHandle = { rootId: string; relativePath: string; kind: "directory" | "file"; name: string };
export type CleanupCategoryId = "runtime-cache" | "previews";
export type CleanupPreview = { token: string; categories: { id: CleanupCategoryId; count: number; bytes: number; files?: { name: string; bytes: number }[] }[] };
export type CleanupResult = { categories: { id: CleanupCategoryId; count: number; bytes: number; failed: number }[]; errors: { name: string; message: string }[] };
type Envelope<T> = { ok: true; value: T } | { ok: false; error: { name: string; message: string; code?: string } };

declare global {
  interface BidDesktopWindowControls {
    getApiKey(): string;
    setApiKey(value: string): void;
    getLocalApiKey(): string;
    setLocalApiKey(value: string): void;
    getSubscriptionApiKey(): string;
    setSubscriptionApiKey(value: string): void;
    skills: ImportedSkillsApi;
    cleanup: {
      preview(): Promise<CleanupPreview>;
      run(input: { token: string; categories: CleanupCategoryId[] }): Promise<CleanupResult>;
    };
    fs: {
      pick(input: { purpose?: string }): Promise<Envelope<NativeHandle | null>>;
      restore(input: { key: string }): Promise<Envelope<NativeHandle | null>>;
      persist(input: { key: string; handle: NativeHandle }): Promise<Envelope<void>>;
      op(input: Record<string, unknown>): Promise<Envelope<unknown>>;
    };
    modelRequest(input: { endpoint: string; authorization: string; body: string }): Promise<{ status: number; body: string }>;
    modelChat(input: { settings: ModelSettings; apiKey: string; localApiKey?: string; subscriptionApiKey?: string; prompt: string; task: ModelTask; images?: string[] }): Promise<ModelChatResult>;
    modelCatalog(input?: { settings: ModelSettings; subscriptionApiKey?: string }): Promise<ModelCatalog>;
    localModelCatalog(input: { settings: ModelSettings; localApiKey?: string }): Promise<LocalModelCatalog>;
    modelTest(input: { settings: ModelSettings; apiKey: string; localApiKey?: string; subscriptionApiKey?: string; provider: ModelChannel }): Promise<{ provider: ModelChannel; model: string; verified: true }>;
  }
}

async function unwrap<T>(promise: Promise<Envelope<T>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.value;
  throw new DOMException(result.error.message, result.error.name);
}

async function operation<T>(handle: NativeHandle, op: string, extra: Record<string, unknown> = {}): Promise<T> {
  const bridge = window.bidDesktop;
  if (!bridge) throw new Error("Desktop file access unavailable");
  return unwrap(bridge.fs.op({ handle, op, ...extra })) as Promise<T>;
}

class DesktopFileHandle {
  readonly kind = "file" as const;
  constructor(readonly native: NativeHandle) {}
  get name() { return this.native.name; }
  async getFile(): Promise<File> {
    const data = await operation<Uint8Array>(this.native, "read");
    const info = await operation<{ lastModified: number }>(this.native, "stat");
    const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", zip: "application/zip" };
    return new File([new Uint8Array(data)], this.name, { type: types[this.name.split(".").at(-1)?.toLowerCase() || ""] || "application/octet-stream", lastModified: info.lastModified });
  }
  async createWritable() {
    let pending: Uint8Array | undefined;
    return {
      write: async (data: Blob | string | ArrayBuffer) => {
        pending = typeof data === "string" ? new TextEncoder().encode(data)
          : new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data);
      },
      close: async () => {
        if (pending) await operation(this.native, "write", { data: pending });
      },
    };
  }
}

export class DesktopDirectoryHandle implements DirectoryHandleLike {
  readonly kind = "directory" as const;
  constructor(readonly native: NativeHandle) {}
  get name() { return this.native.name; }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DesktopDirectoryHandle> {
    return new DesktopDirectoryHandle(await operation<NativeHandle>(this.native, "directory", { name, create: options?.create }));
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<DesktopFileHandle> {
    return new DesktopFileHandle(await operation<NativeHandle>(this.native, "file", { name, create: options?.create }));
  }
  async *entries(): AsyncIterableIterator<[string, DesktopDirectoryHandle | DesktopFileHandle]> {
    for (const [name, native] of await operation<[string, NativeHandle][]>(this.native, "list")) {
      yield [name, native.kind === "directory" ? new DesktopDirectoryHandle(native) : new DesktopFileHandle(native)];
    }
  }
  async isSameEntry(other: DirectoryHandleLike): Promise<boolean> {
    return other instanceof DesktopDirectoryHandle && operation<boolean>(this.native, "same", { data: other.native });
  }
  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    await operation(this.native, "removeEntry", { name, recursive: options?.recursive });
  }
  async trashEntry(name: string, expectedFingerprint?: WorkspaceFileFingerprint): Promise<void> {
    await operation(this.native, "trashEntry", { name, expectedFingerprint });
  }
  async queryPermission(): Promise<PermissionState> { return "granted"; }
  async requestPermission(): Promise<PermissionState> { return "granted"; }
}

export async function pickDesktopDirectory(purpose = "active-workspace"): Promise<DesktopDirectoryHandle> {
  const handle = await unwrap(window.bidDesktop!.fs.pick({ purpose }));
  if (!handle) throw new DOMException("已取消选择 / Folder selection canceled", "AbortError");
  return new DesktopDirectoryHandle(handle);
}

export async function persistDesktopDirectory(key: string, handle: DirectoryHandleLike): Promise<void> {
  if (!(handle instanceof DesktopDirectoryHandle)) return;
  await unwrap(window.bidDesktop!.fs.persist({ key, handle: handle.native }));
}

export async function restoreDesktopDirectory(key: string): Promise<DesktopDirectoryHandle | null> {
  const native = await unwrap(window.bidDesktop!.fs.restore({ key }));
  return native ? new DesktopDirectoryHandle(native) : null;
}

export const desktopAwareFetch: typeof fetch = async (input, init) => {
  if (typeof window === "undefined" || !window.bidDesktop || init?.method !== "POST") return fetch(input, init);
  const endpoint = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const result = await window.bidDesktop.modelRequest({
    endpoint,
    authorization: new Headers(init.headers).get("Authorization") || "",
    body: String(init.body || ""),
  });
  return new Response(result.body, { status: result.status, headers: { "Content-Type": "application/json" } });
};

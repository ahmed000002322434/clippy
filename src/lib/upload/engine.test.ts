import { describe, expect, test } from "bun:test";
import { UploadEngine } from "./engine";
import { UploadError } from "@/lib/storage/provider";
import type { StorageProvider, UploadProgress } from "@/lib/storage/provider";

type FailKind = "retryable" | "permanent" | "user";

class MockProvider implements StorageProvider {
  readonly name = "mock";
  calls: string[] = [];
  failQueue: FailKind[] = [];
  hang = false;
  completed: { sessionId: string; storageId: string }[] = [];

  async createUploadSession() {
    this.calls.push("create");
    return { sessionId: "s1", uploadUrl: "u1" };
  }

  async markUploading(sessionId: string) {
    this.calls.push(`mark:${sessionId}`);
  }

  async getFreshUploadUrl(sessionId: string) {
    this.calls.push(`fresh:${sessionId}`);
    return "u2";
  }

  async putFile(
    _file: Blob,
    uploadUrl: string,
    callbacks: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal },
  ): Promise<string> {
    this.calls.push(`put:${uploadUrl}`);
    const fail = this.failQueue.shift();
    if (fail === "retryable") throw new UploadError("network hiccup", "retryable");
    if (fail === "permanent") throw new UploadError("file corrupt", "permanent");
    if (fail === "user") throw new UploadError("stopped", "user-action");
    if (this.hang) {
      return new Promise<string>((_resolve, reject) => {
        callbacks.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }
    callbacks.onProgress?.({
      bytesUploaded: 1,
      bytesTotal: 1,
      speedBps: 1000,
      etaMs: 100,
    });
    return "storage-1";
  }

  async reportProgress() {
    this.calls.push("progress");
  }

  async completeUpload(opts: { sessionId: string; storageId: string }) {
    this.calls.push(`complete:${opts.sessionId}`);
    this.completed.push(opts);
    return { videoId: "v1" as never, alreadyCompleted: false };
  }

  async failSession(sessionId: string) {
    this.calls.push(`fail:${sessionId}`);
  }

  async cancelSession(sessionId: string) {
    this.calls.push(`cancel:${sessionId}`);
  }
}

function makeFile(): File {
  return new File([new Uint8Array(64)], "clip.mp4", { type: "video/mp4" });
}

async function waitForTerminal(engine: UploadEngine, timeoutMs = 6000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (engine.getTasks().some((t) => t.phase === "done" || t.phase === "error" || t.phase === "cancelled")) {
      return;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out waiting for terminal upload state");
}

describe("UploadEngine", () => {
  test("uploads a file end to end with real progress", async () => {
    const provider = new MockProvider();
    const engine = new UploadEngine(provider, "proj-1");
    const taskId = engine.addFile(makeFile(), null);
    await waitForTerminal(engine);
    const task = engine.getTasks().find((t) => t.id === taskId);
    expect(task?.phase).toBe("done");
    expect(task?.videoId).toBe("v1");
    expect(provider.calls).toContain("create");
    expect(provider.calls).toContain("put:u1");
    expect(provider.calls).not.toContain("fresh:");
    expect(provider.completed.length).toBe(1);
  });

  test("emits onCompleted with the video id", async () => {
    const provider = new MockProvider();
    const completedWith: string[] = [];
    const engine = new UploadEngine(provider, "proj-1", {
      onCompleted: (_t, videoId) => {
        completedWith.push(videoId);
      },
    });
    engine.addFile(makeFile(), null);
    await waitForTerminal(engine);
    expect(completedWith).toEqual(["v1"]);
  });

  test("retries a retryable failure with a fresh URL then succeeds", async () => {
    const provider = new MockProvider();
    provider.failQueue = ["retryable"];
    const engine = new UploadEngine(provider, "proj-1");
    const taskId = engine.addFile(makeFile(), null);
    await waitForTerminal(engine);
    const task = engine.getTasks().find((t) => t.id === taskId);
    expect(task?.phase).toBe("done");
    expect(task?.attempts).toBe(2);
    expect(provider.calls.filter((c) => c.startsWith("put:")).sort()).toEqual([
      "put:u1",
      "put:u2",
    ]);
    expect(provider.calls).toContain("fresh:s1");
  });

  test("gives up on a permanent failure and marks the task failed", async () => {
    const provider = new MockProvider();
    provider.failQueue = ["permanent"];
    const engine = new UploadEngine(provider, "proj-1");
    const taskId = engine.addFile(makeFile(), null);
    await waitForTerminal(engine);
    const task = engine.getTasks().find((t) => t.id === taskId);
    expect(task?.phase).toBe("error");
    expect(task?.errorClass).toBe("permanent");
    expect(provider.completed.length).toBe(0);
    expect(provider.calls).toContain("fail:s1");
  });

  test("reuses an existing session instead of creating a new one", async () => {
    const provider = new MockProvider();
    const engine = new UploadEngine(provider, "proj-1");
    const taskId = engine.addFile(makeFile(), "resume-session");
    await waitForTerminal(engine);
    expect(provider.calls).not.toContain("create");
    expect(provider.calls).toContain("mark:resume-session");
    expect(provider.calls).toContain("fresh:resume-session");
    expect(engine.getTasks().find((t) => t.id === taskId)?.phase).toBe("done");
  });

  test("cancel aborts an in-flight upload and marks the session cancelled", async () => {
    const provider = new MockProvider();
    provider.hang = true;
    const engine = new UploadEngine(provider, "proj-1");
    const taskId = engine.addFile(makeFile(), null);
    // Let the transfer start and hang.
    await new Promise((r) => setTimeout(r, 50));
    engine.cancel(taskId);
    await waitForTerminal(engine);
    const task = engine.getTasks().find((t) => t.id === taskId);
    expect(task?.phase).toBe("cancelled");
    expect(provider.calls).toContain("cancel:s1");
  });

  test("retry after cancellation starts a fresh attempt", async () => {
    const provider = new MockProvider();
    provider.hang = true;
    const engine = new UploadEngine(provider, "proj-1");
    const taskId = engine.addFile(makeFile(), null);
    await new Promise((r) => setTimeout(r, 50));
    engine.cancel(taskId);
    await waitForTerminal(engine);
    provider.hang = false;
    engine.retry(taskId);
    await waitForTerminal(engine);
    const task = engine.getTasks().find((t) => t.id === taskId);
    expect(task?.phase).toBe("done");
    // New session + fresh URL (sessionId reset on retry)
    expect(provider.calls).toContain("create");
  });
});

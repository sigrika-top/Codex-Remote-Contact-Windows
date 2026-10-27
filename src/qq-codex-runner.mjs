import { spawn } from "node:child_process";

// QQ only: wait for a successful completed turn, not CLI teardown. Never send
// commentary, partial tokens, or a message from a failed turn to a contact.
export function runQqCodexJson(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command)
    });
    let stdout = "", stderr = "", buffer = "", sessionId = "", finalText = "";
    let settled = false;
    const timing = { firstEventMs: null, finalMessageMs: null, completedMs: null };
    const stop = () => {
      if (child.exitCode != null || child.killed) return;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true, stdio: "ignore"});
        killer.on("error", () => child.kill());
      } else {
        child.kill("SIGTERM");
      }
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    const complete = event => {
      if (settled) return;
      if (!finalText.trim()) {
        fail(new Error("Codex completed without a final QQ reply"));
        stop();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      timing.completedMs = Date.now() - startedAt;
      resolve({ stdout, stderr, sessionId, finalText, timing, usage: event.usage || null });
      // CLI may take seconds to flush state and shut down. Let it finish normally,
      // but bound cleanup for this invocation so stuck children cannot accumulate.
      cleanupTimer = setTimeout(stop, options.cleanupTimeoutMs ?? 30000);
      cleanupTimer.unref();
    };
    const consume = line => {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (timing.firstEventMs == null) timing.firstEventMs = Date.now() - startedAt;
      if (event.type === "thread.started" && typeof event.thread_id === "string") sessionId = event.thread_id;
      if (event.type === "item.completed" && event.item?.type === "agent_message"
          && (!event.item.phase || event.item.phase === "final_answer")
          && typeof event.item.text === "string") {
        finalText = event.item.text;
        timing.finalMessageMs = Date.now() - startedAt;
      }
      if (event.type === "turn.completed") complete(event);
      if (event.type === "turn.failed") {
        fail(new Error(event.error?.message || "Codex QQ turn failed"));
        stop();
      }
    };
    let cleanupTimer;
    const timeout = setTimeout(() => {
      fail(new Error("Codex CLI timed out while generating a reply"));
      stop();
    }, options.timeout ?? 120000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout = (stdout + chunk).slice(-8000);
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        consume(line);
      }
      // A broken/mismatched CLI must not create an unbounded line buffer.
      if (buffer.length > 4 * 1024 * 1024) {
        fail(new Error("Codex emitted an oversized JSON event"));
        stop();
      }
    });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.stdin.on("error", error => { if (error.code !== "EPIPE") fail(error); });
    child.on("error", fail);
    child.on("close", code => {
      if (buffer.trim()) consume(buffer);
      clearTimeout(cleanupTimer);
      options.onClose?.({ code, closeMs: Date.now() - startedAt, completedMs: timing.completedMs });
      if (!settled) fail(new Error(`Codex CLI exited with ${code} before a completed QQ turn: ${(stderr || stdout).trim()}`));
    });
    child.stdin.end(input);
  });
}

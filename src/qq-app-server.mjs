import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// One private stdio server for QQ. Stored thread IDs remain compatible with exec.
// No automatic turn retry: a broken connection must never replay a user message.
export class QqAppServer {
  constructor(command, args, options = {}) {
    this.command = command; this.args = args; this.options = options;
    this.nextId = 1; this.pending = new Map(); this.active = new Map();
    this.loaded = new Map(); this.reserved = new Set(); this.evicting = new Map();
    this.child = null; this.starting = null;
    this.stderr = ''; this.closed = false;
  }

  snapshot() {
    return { transport: 'app-server', pid: this.child?.pid || null,
      ready: Boolean(this.child && !this.starting), activeTurns: this.active.size,
      loadedThreads: this.loaded.size };
  }

  async start() {
    if (this.closed) throw new Error('QQ app-server is closed');
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this.boot();
    try { await this.starting; } finally { this.starting = null; }
  }

  async boot() {
    const child = spawn(this.command, this.args, {
      cwd: this.options.cwd, env: this.options.env, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child; this.stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => { this.stderr = (this.stderr + data).slice(-4000); });
    child.stdin.on('error', error => { if (this.child === child) this.failConnection(error); });
    child.on('error', error => { if (this.child === child) this.failConnection(error); });
    child.on('close', code => {
      if (this.child === child) this.failConnection(new Error(`QQ app-server exited (${code})`));
    });
    createInterface({ input: child.stdout }).on('line', line => {
      if (this.child !== child) return;
      try { this.receive(JSON.parse(line)); } catch { /* Ignore non-protocol log lines. */ }
    });
    try {
      await this.rpc('initialize', { clientInfo: {
        name: 'qq_reply_hub', title: 'QQ Reply Hub', version: '2.0.0'
      } });
      this.send({ method: 'initialized', params: {} });
    } catch (error) { this.failConnection(error); throw error; }
  }

  send(message) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('QQ app-server disconnected');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  rpc(method, params, timeout = this.options.rpcTimeoutMs ?? 30000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`QQ app-server ${method} timed out`);
        error.code = 'RPC_TIMEOUT'; reject(error);
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  receive(message) {
    if (message.id != null && !message.method) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) {
        const error = new Error(message.error.message || 'QQ app-server RPC failed');
        error.code = message.error.code; request.reject(error);
      } else request.resolve(message.result);
      return;
    }
    if (message.id != null) {
      // QQ has no approval UI or external tool dispatcher. Fail closed.
      this.send({ id: message.id, error: { code: -32601, message: 'Interactive tools are unavailable for QQ chat' } });
      return;
    }
    const p = message.params || {};
    if (message.method === 'thread/closed') this.loaded.delete(p.threadId);
    const turn = this.active.get(p.threadId);
    if (!turn) return;
    const eventTurnId = p.turnId || p.turn?.id;
    if (turn.turnId && eventTurnId && turn.turnId !== eventTurnId) return;
    if (message.method === 'turn/started') turn.turnId = p.turn.id;
    if (message.method === 'thread/tokenUsage/updated') turn.usage = p.tokenUsage;
    if (message.method === 'item/agentMessage/delta' && turn.firstMs == null) turn.firstMs = Date.now() - turn.started;
    if (message.method === 'item/completed' && p.item?.type === 'agentMessage' &&
        (!p.item.phase || p.item.phase === 'final_answer')) turn.finalText = p.item.text || '';
    if (message.method !== 'turn/completed') return;
    clearTimeout(turn.timer); this.active.delete(p.threadId);
    this.loaded.set(p.threadId, Date.now());
    if (turn.expired) return;
    if (p.turn.status !== 'completed' || !turn.finalText.trim()) {
      turn.reject(new Error(p.turn.error?.message || `QQ turn ${p.turn.status} without a final reply`));
      return;
    }
    const usage = turn.usage?.last;
    turn.resolve({ sessionId: p.threadId, finalText: turn.finalText, stderr: '',
      usage: usage ? { input_tokens: usage.inputTokens, cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens } : null,
      timing: { completedMs: Date.now() - turn.started, firstMessageMs: turn.firstMs, setupMs: turn.setupMs },
      transport: 'app-server' });
  }

  async run({ sessionId, prompt, imagePaths = [], model, effort, baseInstructions, onSession,
    timeoutMs = 120000 }) {
    const started = Date.now();
    await this.start();
    let threadId = sessionId;
    if (threadId && (this.active.has(threadId) || this.reserved.has(threadId))) throw new Error('QQ conversation already has an active turn');
    if (threadId) this.reserved.add(threadId);
    try {
    if (threadId && this.evicting.has(threadId)) await this.evicting.get(threadId);
    if (!threadId || !this.loaded.has(threadId)) {
      const params = { model, cwd: this.options.cwd, approvalPolicy: 'never', sandbox: 'read-only',
        baseInstructions, config: { 'agents.enabled': false, 'skills.bundled.enabled': false,
          'skills.include_instructions': false } };
      const response = await this.rpc(threadId ? 'thread/resume' : 'thread/start',
        threadId ? { ...params, threadId, excludeTurns: true } : params);
      threadId = response.thread.id;
      this.loaded.set(threadId, Date.now());
      this.reserved.add(threadId);
    }
    // Persist a new ID before starting inference, even if this turn later fails.
    if (onSession) await onSession(threadId);
    if (this.active.has(threadId)) throw new Error('QQ conversation already has an active turn');
    await this.trimThreads(threadId);
    const input = [{ type: 'text', text: prompt }, ...imagePaths.map(path => ({ type: 'localImage', path }))];
    const turn = { started, setupMs: Date.now() - started, finalText: '', turnId: null, expired: false };
    const completion = new Promise((resolve, reject) => { turn.resolve = resolve; turn.reject = reject; });
    // Attach before issuing RPC: events may precede its response.
    completion.catch(() => {});
    this.active.set(threadId, turn);
    this.reserved.delete(threadId);
    turn.timer = setTimeout(() => { void this.expire(threadId, turn); }, timeoutMs);
    try {
      const response = await this.rpc('turn/start', { threadId, input, model, effort, approvalPolicy: 'never' });
      turn.turnId ||= response.turn?.id;
    } catch (error) {
      if (error.code === 'RPC_TIMEOUT') {
        // Acceptance is ambiguous; disconnect instead of replaying or allowing overlap.
        this.failConnection(error);
      } else {
        clearTimeout(turn.timer); this.active.delete(threadId); turn.reject(error);
      }
    }
    return completion;
    } finally { this.reserved.delete(threadId); }
  }

  async expire(threadId, turn) {
    if (this.active.get(threadId) !== turn) return;
    turn.expired = true;
    turn.reject(new Error('QQ app-server turn timed out; it was not retried'));
    if (!turn.turnId) { this.failConnection(new Error('Timed out before turn ID was received')); return; }
    try {
      await this.rpc('turn/interrupt', { threadId, turnId: turn.turnId }, 5000);
      if (this.active.get(threadId) === turn) {
        turn.timer = setTimeout(() => {
          if (this.active.get(threadId) === turn) this.failConnection(new Error('QQ turn did not stop after interrupt'));
        }, 5000);
      }
    } catch (error) { this.failConnection(error); }
  }

  async trimThreads(keep) {
    const limit = this.options.maxLoadedThreads ?? 16;
    for (const [id] of [...this.loaded].sort((a, b) => a[1] - b[1])) {
      if (this.loaded.size <= limit) break;
      if (id === keep || this.active.has(id) || this.reserved.has(id)) continue;
      // Remove before await so concurrent requests cannot evict the same idle thread twice.
      this.loaded.delete(id);
      const eviction = this.rpc('thread/unsubscribe', { threadId: id }, 5000).catch(() => null);
      this.evicting.set(id, eviction);
      try { await eviction; } finally { this.evicting.delete(id); }
    }
  }

  failConnection(error) {
    const child = this.child; this.child = null; this.loaded.clear();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
    for (const turn of this.active.values()) { clearTimeout(turn.timer); turn.reject(error); }
    this.active.clear();
    if (!child) return;
    child.stdin.destroy();
    if (process.platform === 'win32' && child.pid && child.exitCode == null) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else child.kill();
  }

  close() { this.closed = true; this.failConnection(new Error('QQ app-server closed')); }
}

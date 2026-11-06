// Tiny Chrome DevTools Protocol client for the e2e test (Node >= 22: global fetch + WebSocket).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const waitFor = async (fn, what, timeoutMs = 20000) => {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${what}: ${last}`);
};

/** Starts a browser with a throwaway profile and the unpacked extension. */
export const launchBrowser = ({ binary, extensionDir, port, lang = 'en' }) => {
  const profile = mkdtempSync(join(tmpdir(), 'tab-sorter-e2e-'));
  const proc = spawn(binary, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    // Brave & Chromium still honour --load-extension. Google Chrome >= 137
    // ignores it; there the extension is loaded via CDP over the pipe below.
    `--load-extension=${extensionDir}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--disable-sync',
    `--lang=${lang}`,
    // macOS ignores --lang; Cocoa apps read the language from this argument pair
    ...(process.platform === 'darwin' ? ['-AppleLanguages', `(${lang})`] : []),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  // CDP over pipe: fd 3 = to browser, fd 4 = from browser, NUL-terminated JSON.
  const pipeOut = proc.stdio[3];
  const pipeIn = proc.stdio[4];
  let buffer = '';
  let pipeId = 0;
  const pipePending = new Map();
  pipeIn.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.id && pipePending.has(msg.id)) {
        pipePending.get(msg.id)(msg);
        pipePending.delete(msg.id);
      }
    }
  });
  const pipeSend = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++pipeId;
    pipePending.set(msgId, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    pipeOut.write(`${JSON.stringify({ id: msgId, method, params })}\0`);
  });

  /** Loads the extension unless the browser already did via --load-extension. */
  const ensureExtension = async (extensionId) => {
    await sleep(1500);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    if (list.some((t) => t.url.startsWith(`chrome-extension://${extensionId}/`))) return 'flag';
    const { id } = await pipeSend('Extensions.loadUnpacked', { path: extensionDir });
    if (id !== extensionId) throw new Error(`loaded extension has id ${id}, expected ${extensionId}`);
    return 'cdp';
  };

  const close = async () => {
    proc.kill();
    await sleep(1000);
    rmSync(profile, { recursive: true, force: true });
  };
  return {
    close,
    ensureExtension,
    targets: async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json(),
  };
};

/** Connects to one target (page or service worker) and returns helpers. */
export const attach = async (webSocketDebuggerUrl) => {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
};

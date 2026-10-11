import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/**
 * Chronolignée for Windows: the whole application on one computer.
 *
 * Everything the server edition spreads over services runs here as child
 * processes of this one: PostgreSQL with PostGIS (shipped binaries, a data
 * directory in the user's profile), the worker, and the web server, all on
 * 127.0.0.1 only. There is no Redis and no object store: the queue lives in
 * PostgreSQL and the archive in a folder (QUEUE_DRIVER=postgres,
 * STORAGE_DRIVER=filesystem).
 *
 * Secrets are generated on first launch and kept in the profile; nothing is
 * built in. Nothing listens beyond this machine.
 */

interface DesktopConfig {
  dbPassword: string;
  authSecret: string;
  webPort: number;
  pgPort: number;
  seeded: boolean;
}

// Before any path is read: the profile folder is named after the app.
app.setName('Chronolignée');

/**
 * Where the servers live. Packaged, they ship as three archives (an
 * installer that writes ninety thousand small files is one Windows Defender
 * scans one by one, for many minutes) and are unpacked once per version into
 * the local profile on first launch. In development they are used from
 * apps/desktop/stage as they are.
 */
const PARTS = ['pgsql', 'worker', 'web'] as const;
const localAppData = process.env['LOCALAPPDATA'] ?? join(app.getPath('appData'), '..', 'Local');
const runtimeRoot = join(localAppData, 'Chronolignée', 'runtime');
const runtime = app.isPackaged
  ? join(runtimeRoot, app.getVersion())
  : join(__dirname, '..', 'stage');
const paths = {
  pgBin: join(runtime, 'pgsql', 'bin'),
  worker: join(runtime, 'worker'),
  web: join(runtime, 'web'),
  data: join(app.getPath('userData'), 'data'),
  logs: join(app.getPath('userData'), 'logs'),
};
const pgData = join(paths.data, 'postgres');
const archive = join(paths.data, 'archive');
const configFile = join(app.getPath('userData'), 'desktop.json');

const children: ChildProcess[] = [];
let mainWindow: BrowserWindow | null = null;
let splash: BrowserWindow | null = null;
let quitting = false;

// --- Configuration -----------------------------------------------------------

async function freePort(preferred: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number | null>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(null));
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => resolve(typeof address === 'object' && address ? address.port : null));
      });
    });
  return (await tryPort(preferred)) ?? (await tryPort(0)) ?? preferred;
}

async function loadConfig(): Promise<DesktopConfig> {
  const secret = () => randomBytes(32).toString('base64url');
  let config: DesktopConfig;
  try {
    config = JSON.parse(readFileSync(configFile, 'utf8')) as DesktopConfig;
  } catch {
    config = {
      dbPassword: secret(),
      authSecret: secret(),
      webPort: 47830,
      pgPort: 47831,
      seeded: false,
    };
  }
  // The same ports from one launch to the next when they are free, so the
  // address the sessions were issued for stays the address of the app.
  config.webPort = await freePort(config.webPort);
  if (!existsSync(join(pgData, 'postmaster.pid'))) config.pgPort = await freePort(config.pgPort);
  if (config.pgPort === config.webPort) config.pgPort = await freePort(0);
  saveConfig(config);
  return config;
}

function saveConfig(config: DesktopConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function databaseUrl(config: DesktopConfig): string {
  return `postgresql://chronolignee:${encodeURIComponent(config.dbPassword)}@127.0.0.1:${config.pgPort}/chronolignee`;
}

/** The environment every child runs with: the server edition's, pointed at this machine. */
function childEnv(config: DesktopConfig): NodeJS.ProcessEnv {
  // `localhost`, not 127.0.0.1: the locale middleware rewrites to `localhost`,
  // and Next treats a rewrite to any other host as a proxy to a foreign site —
  // a redirect loop on every page.
  const origin = `http://localhost:${config.webPort}`;
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    APP_URL: origin,
    BETTER_AUTH_URL: origin,
    TRUSTED_ORIGINS: origin,
    BETTER_AUTH_SECRET: config.authSecret,
    DATABASE_URL: databaseUrl(config),
    QUEUE_DRIVER: 'postgres',
    // Required by the schema, never connected to with QUEUE_DRIVER=postgres.
    REDIS_URL: 'redis://127.0.0.1:1',
    STORAGE_DRIVER: 'filesystem',
    STORAGE_PATH: archive,
    // Required by the schema, never read with STORAGE_DRIVER=filesystem.
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_REGION: 'local',
    S3_BUCKET: 'local',
    S3_ACCESS_KEY_ID: 'local',
    S3_SECRET_ACCESS_KEY: 'local',
    AI_PROVIDER: 'none',
    MAIL_TRANSPORT: 'none',
    FEATURE_CONSTELLATION: 'true',
    FEATURE_TEMPORAL_DEPTH: 'true',
    FEATURE_RIVER: 'true',
    FEATURE_STORY_DIRECTOR: 'true',
    LOG_LEVEL: 'warn',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}

// --- Processes -----------------------------------------------------------------

function log(name: string): number {
  mkdirSync(paths.logs, { recursive: true });
  return openSync(join(paths.logs, `${name}.log`), 'a');
}

/** Run a Node script with the Electron binary acting as Node, and wait for it. */
function runNode(
  name: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  keepRunning = false,
): Promise<ChildProcess> {
  const out = log(name);
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  if (keepRunning) {
    children.push(child);
    child.once('exit', (code) => {
      if (!quitting) {
        void fail(
          `${name} s’est arrêté (code ${code ?? '?'}). Journal : ${join(paths.logs, `${name}.log`)}`,
        );
      }
    });
    return Promise.resolve(child);
  }
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve(child) : reject(new Error(`${name} a échoué (code ${code ?? '?'})`)),
    );
  });
}

interface ToolResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * A PostgreSQL tool, without blocking the main process: a synchronous call
 * here froze the window — Windows then labels it "not responding" — for as
 * long as initdb or a server start took.
 */
function pgTool(
  tool: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = spawn(join(paths.pgBin, `${tool}.exe`), args, {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const timer = setTimeout(() => child.kill(), 120_000);
    // pg_ctl leaves the server running, holding the pipes it inherited: the
    // tool is done when it exits, not when its output closes.
    child.once('exit', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ status: -1, stdout, stderr: String(error) });
    });
  });
}

/** Stop the server, synchronously: used while the process is exiting. */
function pgToolSync(tool: string, args: string[]): void {
  spawnSync(join(paths.pgBin, `${tool}.exe`), args, {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 60_000,
  });
}

async function startPostgres(config: DesktopConfig): Promise<void> {
  const pgEnv = { ...process.env, PGPASSWORD: config.dbPassword };
  if (!existsSync(join(pgData, 'PG_VERSION'))) {
    mkdirSync(paths.data, { recursive: true });
    const pwfile = join(paths.data, '.pw');
    writeFileSync(pwfile, config.dbPassword, { mode: 0o600 });
    const init = await pgTool('initdb', [
      '-D',
      pgData,
      '-U',
      'chronolignee',
      `--pwfile=${pwfile}`,
      '-A',
      'scram-sha-256',
      '-E',
      'UTF8',
      '--locale-provider=icu',
      '--icu-locale=fr-FR',
      '--locale=C',
    ]);
    rmSync(pwfile, { force: true });
    if (init.status !== 0) throw new Error(`initdb : ${init.stderr || init.stdout}`);
  }

  const running = await pgTool('pg_ctl', ['-D', pgData, 'status']);
  if (running.status === 0) {
    // Still running from a session that did not close cleanly: use it, on
    // the port it actually listens on (line 4 of postmaster.pid).
    const port = Number(readFileSync(join(pgData, 'postmaster.pid'), 'utf8').split(/\r?\n/)[3]);
    if (Number.isInteger(port) && port > 0) {
      config.pgPort = port;
      saveConfig(config);
    }
  } else {
    const started = await pgTool('pg_ctl', [
      '-D',
      pgData,
      '-l',
      join(paths.logs, 'postgres.log'),
      '-w',
      '-t',
      '60',
      '-o',
      `-p ${config.pgPort} -c listen_addresses=127.0.0.1`,
      'start',
    ]);
    if (started.status !== 0) throw new Error(`PostgreSQL : ${started.stderr || started.stdout}`);
  }

  const exists = await pgTool(
    'psql',
    [
      '-h',
      '127.0.0.1',
      '-p',
      String(config.pgPort),
      '-U',
      'chronolignee',
      '-d',
      'postgres',
      '-tAc',
      "SELECT 1 FROM pg_database WHERE datname = 'chronolignee'",
    ],
    pgEnv,
  );
  if (exists.status !== 0) throw new Error(`PostgreSQL : ${exists.stderr}`);
  if (exists.stdout.trim() !== '1') {
    const created = await pgTool(
      'createdb',
      ['-h', '127.0.0.1', '-p', String(config.pgPort), '-U', 'chronolignee', 'chronolignee'],
      pgEnv,
    );
    if (created.status !== 0) throw new Error(`createdb : ${created.stderr}`);
  }
}

function stopPostgres(): void {
  if (existsSync(join(pgData, 'postmaster.pid'))) {
    pgToolSync('pg_ctl', ['-D', pgData, '-m', 'fast', '-w', 'stop']);
  }
}

/**
 * Unpack the servers for this version, once. Windows' own tar does it; a
 * half-unpacked folder (the app closed mid-way) has no marker and is redone.
 * Older versions' folders are removed afterwards.
 */
async function ensureRuntime(): Promise<void> {
  if (!app.isPackaged) return;
  const marker = join(runtime, '.complete');
  if (existsSync(marker)) return;
  rmSync(runtime, { recursive: true, force: true });
  mkdirSync(runtime, { recursive: true });
  const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
  for (const [index, part] of PARTS.entries()) {
    status(`Première ouverture : installation des composants (${index + 1}/${PARTS.length})…`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(tar, ['-xf', join(process.resourcesPath, `${part}.tar`), '-C', runtime], {
        windowsHide: true,
        stdio: 'ignore',
      });
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`décompression de ${part} : code ${code ?? '?'}`)),
      );
    });
  }
  writeFileSync(marker, new Date().toISOString());
}

/**
 * Remove older versions' servers, best effort and after start-up: a file
 * still held by an older copy of the app (or by Windows Defender) is simply
 * left for next time. Tidying up must never stop the app from opening.
 */
function removeOldRuntimes(): void {
  if (!app.isPackaged) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(runtimeRoot);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === app.getVersion()) continue;
    try {
      rmSync(join(runtimeRoot, entry), { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // In use; tried again on the next launch.
    }
  }
}

async function waitForWeb(port: number): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('le serveur web ne répond pas');
}

// --- Windows -------------------------------------------------------------------

function showSplash(): void {
  splash = new BrowserWindow({
    width: 420,
    height: 240,
    frame: false,
    resizable: false,
    backgroundColor: '#0b1020',
    show: true,
    center: true,
    // In front of the folder it was opened from: a splash hidden behind
    // Explorer reads as "nothing happened".
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Chronolignée',
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  splash.focus();
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b1020;color:#e9e4d8;font-family:Georgia,serif">
  <div style="font-size:28px;letter-spacing:-0.5px">Chronolignée</div>
  <div id="m" style="margin-top:14px;font:13px system-ui;color:#a9b0c0">Ouverture des archives…</div>
  <div style="margin-top:18px;width:160px;height:2px;background:#1e2846;overflow:hidden"><div style="width:40%;height:100%;background:#f0b35a;animation:s 1.4s ease-in-out infinite"></div></div>
  <style>@keyframes s{from{transform:translateX(-100%)}to{transform:translateX(260%)}}</style></body>`;
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function status(message: string): void {
  void splash?.webContents
    .executeJavaScript(`document.getElementById('m').textContent = ${JSON.stringify(message)}`)
    .catch(() => undefined);
}

function openMain(port: number): void {
  const origin = `http://localhost:${port}`;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b1020',
    title: 'Chronolignée',
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Only the local application inside the window; anything else opens in
  // the user's browser, where they can see the address.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.once('ready-to-show', () => {
    const window = mainWindow;
    if (!window) return;
    // Windows does not let an app take the foreground on its own once the
    // user has clicked elsewhere: the window opened behind Explorer and the
    // app looked as if it had stopped after its splash. Shown on top for a
    // moment, then an ordinary window again.
    window.show();
    window.setAlwaysOnTop(true);
    window.moveTop();
    window.focus();
    app.focus({ steal: true });
    splash?.close();
    splash = null;
    setTimeout(() => window.setAlwaysOnTop(false), 1500);
  });
  void mainWindow.loadURL(`${origin}/app`);
}

async function fail(message: string): Promise<void> {
  try {
    mkdirSync(paths.logs, { recursive: true });
    appendFileSync(
      join(paths.logs, 'startup.log'),
      `${new Date().toISOString()} ${message}
`,
    );
  } catch {
    // The dialog below still says it.
  }
  splash?.close();
  await dialog.showMessageBox({
    type: 'error',
    title: 'Chronolignée',
    message: 'Chronolignée n’a pas pu démarrer.',
    detail: message,
  });
  app.quit();
}

// --- Life cycle ----------------------------------------------------------------

async function start(): Promise<void> {
  mkdirSync(paths.logs, { recursive: true });
  appendFileSync(
    join(paths.logs, 'startup.log'),
    `${new Date().toISOString()} lancement ${app.getVersion()} (${process.execPath})\n`,
  );
  showSplash();
  await ensureRuntime();
  const config = await loadConfig();
  const tsx = join(paths.worker, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  status('Démarrage de la base de données…');
  await startPostgres(config);
  // After the database is up: its port may be the one a previous session left.
  const env = childEnv(config);

  status('Mise à jour du schéma…');
  await runNode('migrate', [tsx, 'src/desktop/migrate.ts'], paths.worker, env);

  if (!config.seeded) {
    status('Installation de la famille de démonstration…');
    await runNode(
      'seed',
      [tsx, join('node_modules', '@chronolignee', 'db', 'src', 'seed', 'index.ts')],
      paths.worker,
      env,
    );
    await runNode('seed-photos', [tsx, 'src/demo-photos/seed.ts'], paths.worker, env);
    config.seeded = true;
    saveConfig(config);
  }

  status('Lancement de l’application…');
  await runNode('worker', [tsx, 'src/index.ts'], paths.worker, env, true);
  await runNode(
    'web',
    [join(paths.web, 'apps', 'web', 'server.js')],
    join(paths.web, 'apps', 'web'),
    { ...env, PORT: String(config.webPort), HOSTNAME: 'localhost' },
    true,
  );
  await waitForWeb(config.webPort);
  openMain(config.webPort);
  setTimeout(removeOldRuntimes, 30_000);
}

function shutdown(): void {
  if (quitting) return;
  quitting = true;
  for (const child of children) child.kill();
  stopPostgres();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second click while the app is open — or still starting — brings its
  // window forward instead of doing nothing.
  app.on('second-instance', () => {
    const window = mainWindow ?? splash;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  Menu.setApplicationMenu(null);
  app.whenReady().then(() => start().catch((error: unknown) => fail(String(error))));
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', shutdown);
  process.on('exit', shutdown);
}

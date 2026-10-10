import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
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

const resources = app.isPackaged ? process.resourcesPath : join(__dirname, '..', 'stage');
const paths = {
  pgBin: join(resources, 'pgsql', 'bin'),
  worker: join(resources, 'worker'),
  web: join(resources, 'web'),
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

function pgTool(tool: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(join(paths.pgBin, `${tool}.exe`), args, {
    env,
    windowsHide: true,
    encoding: 'utf8',
    // pg_ctl leaves the server running; ignoring its output keeps it from
    // holding this call open on the server's handles.
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

function startPostgres(config: DesktopConfig): void {
  const pgEnv = { ...process.env, PGPASSWORD: config.dbPassword };
  if (!existsSync(join(pgData, 'PG_VERSION'))) {
    mkdirSync(paths.data, { recursive: true });
    const pwfile = join(paths.data, '.pw');
    writeFileSync(pwfile, config.dbPassword, { mode: 0o600 });
    const init = pgTool('initdb', [
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

  const status = pgTool('pg_ctl', ['-D', pgData, 'status']);
  if (status.status === 0) {
    // Still running from a session that did not close cleanly: use it, on
    // the port it actually listens on (line 4 of postmaster.pid).
    const port = Number(readFileSync(join(pgData, 'postmaster.pid'), 'utf8').split(/\r?\n/)[3]);
    if (Number.isInteger(port) && port > 0) {
      config.pgPort = port;
      saveConfig(config);
    }
  } else {
    const started = pgTool('pg_ctl', [
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

  const exists = pgTool(
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
    const created = pgTool(
      'createdb',
      ['-h', '127.0.0.1', '-p', String(config.pgPort), '-U', 'chronolignee', 'chronolignee'],
      pgEnv,
    );
    if (created.status !== 0) throw new Error(`createdb : ${created.stderr}`);
  }
}

function stopPostgres(): void {
  if (existsSync(join(pgData, 'postmaster.pid'))) {
    pgTool('pg_ctl', ['-D', pgData, '-m', 'fast', '-w', 'stop']);
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
    webPreferences: { sandbox: true, contextIsolation: true },
  });
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
    splash?.close();
    splash = null;
    mainWindow?.show();
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
  showSplash();
  const config = await loadConfig();
  const tsx = join(paths.worker, 'node_modules', 'tsx', 'dist', 'cli.mjs');

  status('Démarrage de la base de données…');
  startPostgres(config);
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
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  Menu.setApplicationMenu(null);
  app.whenReady().then(() => start().catch((error: unknown) => fail(String(error))));
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', shutdown);
  process.on('exit', shutdown);
}

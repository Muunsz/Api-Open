const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
} = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

let mainWindow = null;

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      width: Number(parsed.width) || 1360,
      height: Number(parsed.height) || 860,
      x: typeof parsed.x === 'number' ? parsed.x : undefined,
      y: typeof parsed.y === 'number' ? parsed.y : undefined,
      isMaximized: Boolean(parsed.isMaximized),
    };
  } catch {
    return { width: 1360, height: 860, isMaximized: false };
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const isMaximized = win.isMaximized();
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(
      getWindowStatePath(),
      JSON.stringify({ ...bounds, isMaximized }, null, 2),
      'utf8',
    );
  } catch {
    // ignore state persistence errors
  }
}

function buildRequestTarget(payload) {
  const target = new URL(payload.url);
  if (payload.queryParams && typeof payload.queryParams === 'object') {
    for (const [k, v] of Object.entries(payload.queryParams)) {
      if (k) target.searchParams.set(k, v == null ? '' : String(v));
    }
  }
  if (payload.auth && payload.auth.type === 'apikey' && payload.auth.apiKey) {
    const { key, value, addTo } = payload.auth.apiKey;
    if (addTo === 'query' && key) {
      target.searchParams.set(key, value || '');
    }
  }
  return target;
}

function buildHeadersAndBody(payload) {
  const headers = {};
  if (payload.headers && typeof payload.headers === 'object') {
    for (const [k, v] of Object.entries(payload.headers)) {
      if (k && v !== undefined && v !== null) {
        headers[k] = String(v);
      }
    }
  }

  if (payload.auth) {
    if (payload.auth.type === 'bearer' && payload.auth.bearer?.token) {
      headers['Authorization'] = `Bearer ${payload.auth.bearer.token}`;
    } else if (payload.auth.type === 'basic' && payload.auth.basic) {
      const token = Buffer.from(
        `${payload.auth.basic.username || ''}:${payload.auth.basic.password || ''}`,
      ).toString('base64');
      headers['Authorization'] = `Basic ${token}`;
    } else if (
      payload.auth.type === 'apikey' &&
      payload.auth.apiKey?.addTo !== 'query' &&
      payload.auth.apiKey?.key
    ) {
      headers[payload.auth.apiKey.key] = payload.auth.apiKey.value || '';
    }
  }

  let bodyBuffer = null;
  const method = (payload.method || 'GET').toUpperCase();
  const hasHeader = (name) =>
    Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());

  if (method !== 'GET' && method !== 'HEAD' && payload.body) {
    const mode = payload.body.mode;
    if (mode === 'raw') {
      const raw = payload.body.raw || '';
      bodyBuffer = Buffer.from(raw, 'utf8');
      if (!hasHeader('content-type') && payload.body.rawType === 'json') {
        headers['Content-Type'] = 'application/json';
      }
    } else if (mode === 'urlencoded') {
      const params = new URLSearchParams();
      for (const row of payload.body.urlencoded || []) {
        if (row && row.enabled && row.key) {
          params.append(row.key, row.value || '');
        }
      }
      bodyBuffer = Buffer.from(params.toString(), 'utf8');
      if (!hasHeader('content-type')) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    } else if (mode === 'formdata') {
      const boundary = `----ApiOpenBoundary${Date.now().toString(16)}`;
      const parts = [];
      for (const row of payload.body.formData || []) {
        if (!row || !row.enabled || !row.key) continue;
        parts.push(
          `--${boundary}\r\nContent-Disposition: form-data; name="${String(row.key).replace(/"/g, '\\"')}"\r\n\r\n${row.value ?? ''}\r\n`,
        );
      }
      parts.push(`--${boundary}--\r\n`);
      bodyBuffer = Buffer.from(parts.join(''), 'utf8');
      if (!hasHeader('content-type')) {
        headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      }
    } else if (mode === 'graphql') {
      let variables = {};
      try {
        variables = payload.body.graphql?.variables
          ? JSON.parse(payload.body.graphql.variables)
          : {};
      } catch {
        variables = {};
      }
      bodyBuffer = Buffer.from(
        JSON.stringify({
          query: payload.body.graphql?.query || '',
          variables,
        }),
        'utf8',
      );
      if (!hasHeader('content-type')) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  return { method, headers, bodyBuffer };
}

function sendSingleNodeHttp(targetUrl, method, headers, bodyBuffer, options) {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const req = transport.request(
      targetUrl,
      {
        method,
        headers,
        timeout: options.timeoutMs,
        rejectUnauthorized: options.verifySsl,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const responseHeaders = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
            }
          }
          resolve({
            status: res.statusCode || 0,
            statusText: res.statusMessage || '',
            headers: responseHeaders,
            buffer,
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timed out after ${options.timeoutMs} ms`));
    });
    req.on('error', reject);

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

async function executeLocalDesktopRequest(payload) {
  const startedAt = Date.now();
  let currentUrl = buildRequestTarget(payload);
  let { method, headers, bodyBuffer } = buildHeadersAndBody(payload);

  const timeoutMs = Math.min(
    Math.max(Number(payload.timeoutMs) || 15000, 500),
    30000,
  );
  const verifySsl = payload.verifySsl !== false;
  const followRedirects = payload.followRedirects !== false;
  const maxRedirects = Math.min(
    Math.max(Number(payload.maxRedirects) || 10, 0),
    20,
  );

  let response = await sendSingleNodeHttp(
    currentUrl,
    method,
    headers,
    bodyBuffer,
    { timeoutMs, verifySsl },
  );

  let redirects = 0;
  while (
    followRedirects &&
    redirects < maxRedirects &&
    [301, 302, 303, 307, 308].includes(response.status) &&
    response.headers.location
  ) {
    currentUrl = new URL(response.headers.location, currentUrl);
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      method = 'GET';
      bodyBuffer = null;
    }
    redirects += 1;
    response = await sendSingleNodeHttp(
      currentUrl,
      method,
      headers,
      bodyBuffer,
      { timeoutMs, verifySsl },
    );
  }

  const durationMs = Math.max(1, Date.now() - startedAt);
  const contentType = (response.headers['content-type'] || '').toLowerCase();
  const isBinary =
    contentType.startsWith('image/') ||
    contentType.includes('application/octet-stream') ||
    contentType.includes('application/pdf');

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: isBinary
      ? response.buffer.toString('base64')
      : response.buffer.toString('utf8'),
    isBase64: isBinary,
    sizeBytes: response.buffer.length,
    durationMs,
    timing: {
      totalMs: durationMs,
    },
  };
}

function resolveAppIcon() {
  const iconFile =
    process.platform === 'win32' ? 'API-OPEN-LOGO.ico' : 'API-OPEN-LOGO.png';
  const candidates = [
    path.join(process.resourcesPath, 'web-dist', iconFile),
    path.join(__dirname, '../web/dist', iconFile),
    path.join(__dirname, '../web/public', iconFile),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function setupApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function compareSemver(a, b) {
  const parse = (v) =>
    String(v || '0')
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function getPlatformAssetName() {
  if (process.platform === 'win32') return 'Api-Open-Electron-Windows.exe';
  if (process.platform === 'darwin') return 'Api-Open-Electron-macOS.dmg';
  return 'Api-Open-Electron-Linux.AppImage';
}

function fetchJson(urlStr, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(
      parsed,
      {
        headers: {
          'User-Agent': 'Api-Open-Desktop',
          Accept: 'application/vnd.github+json',
        },
        timeout: 12000,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsed).toString();
          resolve(fetchJson(nextUrl, maxRedirects - 1));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(text));
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Update check timed out')));
    req.on('error', reject);
  });
}

function downloadFileWithRedirects(urlStr, destPath, maxRedirects = 6) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(
      parsed,
      {
        headers: { 'User-Agent': 'Api-Open-Desktop' },
        timeout: 120000,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          maxRedirects > 0
        ) {
          res.resume();
          const nextUrl = new URL(res.headers.location, parsed).toString();
          resolve(downloadFileWithRedirects(nextUrl, destPath, maxRedirects - 1));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`Download failed with HTTP ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(destPath);
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => resolve(destPath));
        });
        out.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Download timed out')));
    req.on('error', reject);
  });
}

async function checkForDesktopUpdates() {
  const currentVersion = app.getVersion();
  try {
    const data = await fetchJson(
      'https://api.github.com/repos/Muunsz/Api-Open/releases/latest',
    );
    const latestTag = String(data.tag_name || '').trim();
    const latestVersion = latestTag.replace(/^v/i, '');
    const assetName = getPlatformAssetName();
    const asset = (data.assets || []).find((a) => a.name === assetName);
    const updateAvailable =
      Boolean(latestVersion) && compareSemver(latestVersion, currentVersion) > 0;
    return {
      currentVersion,
      latestVersion: latestVersion || currentVersion,
      updateAvailable,
      releaseName: data.name || latestTag || `v${currentVersion}`,
      releaseNotes: String(data.body || '').trim(),
      releaseUrl:
        data.html_url || 'https://github.com/Muunsz/Api-Open/releases/latest',
      downloadUrl: asset?.browser_download_url || data.html_url || '',
      assetName: asset?.name || assetName,
    };
  } catch (err) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      error: err instanceof Error ? err.message : 'Failed to check updates',
    };
  }
}

function createWindow() {
  const state = loadWindowState();
  const appIcon = resolveAppIcon();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    title: 'Api-Open',
    ...(appIcon ? { icon: appIcon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false);
  }

  if (state.isMaximized) {
    win.maximize();
  }

  win.on('close', () => saveWindowState(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  const packagedDist = path.join(process.resourcesPath, 'web-dist', 'index.html');
  const localDist = path.join(__dirname, '../web/dist/index.html');

  if (process.env.API_OPEN_URL) {
    win.loadURL(process.env.API_OPEN_URL);
  } else if (process.env.API_OPEN_DEV === '1') {
    win.loadURL('http://localhost:9999').catch(() => {
      if (fs.existsSync(localDist)) win.loadFile(localDist);
    });
  } else if (fs.existsSync(packagedDist)) {
    win.loadFile(packagedDist);
  } else if (fs.existsSync(localDist)) {
    win.loadFile(localDist);
  } else {
    win.loadURL('http://localhost:9999');
  }

  win.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const info = await checkForDesktopUpdates();
      if (info.updateAvailable && !win.isDestroyed()) {
        win.webContents.send('api-open:update-available', info);
      }
    }, 1500);
  });

  mainWindow = win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAsDefaultProtocolClient('apiopen');

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupApplicationMenu();

    ipcMain.handle('api-open:execute-request', async (_event, payload) => {
      return executeLocalDesktopRequest(payload);
    });

    ipcMain.handle('api-open:save-file', async (_event, options = {}) => {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: options.defaultPath,
        filters: options.filters,
      });
      if (canceled || !filePath) return { canceled: true };
      fs.writeFileSync(filePath, options.content ?? '', 'utf8');
      return { canceled: false, filePath };
    });

    ipcMain.handle('api-open:open-file', async (_event, options = {}) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: options.filters,
      });
      if (canceled || !filePaths.length) return { canceled: true };
      const content = fs.readFileSync(filePaths[0], 'utf8');
      return { canceled: false, filePath: filePaths[0], content };
    });

    ipcMain.handle('api-open:check-updates', async () => {
      return checkForDesktopUpdates();
    });

    ipcMain.handle('api-open:download-update', async (_event, payload = {}) => {
      const url = payload.url;
      const fileName = payload.fileName || getPlatformAssetName();
      if (!url) return { ok: false, error: 'Missing download URL' };
      try {
        const downloadsDir = app.getPath('downloads');
        const destPath = path.join(downloadsDir, fileName);
        await downloadFileWithRedirects(url, destPath);
        const openErr = await shell.openPath(destPath);
        if (openErr) {
          shell.showItemInFolder(destPath);
        }
        return { ok: true, filePath: destPath };
      } catch (err) {
        if (url) await shell.openExternal(url);
        return {
          ok: false,
          openedExternal: true,
          error: err instanceof Error ? err.message : 'Download failed',
        };
      }
    });

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

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

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub Releases',
          click: () =>
            shell.openExternal('https://github.com/Muunsz/Api-Open/releases'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 960,
    minHeight: 640,
    title: 'Api-Open',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

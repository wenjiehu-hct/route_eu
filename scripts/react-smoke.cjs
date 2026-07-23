const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(os.tmpdir(), `route-planner-react-smoke-${process.pid}`));
const useDist = process.env.SMOKE_DIST === '1';
const vite = useDist ? null : spawn('node', [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '4179'], {
  cwd: root,
  stdio: 'ignore',
  windowsHide: true,
});

let failed = false;
const errors = [];

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:4179');
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Vite smoke-test server did not start');
}

app.whenReady().then(async () => {
  try {
    if (!useDist) await waitForServer();
    const window = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, sandbox: true } });
    window.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      failed = true;
      errors.push(`Renderer exited: ${details.reason}`);
    });
    if (useDist) await window.loadFile(path.join(root, 'dist', 'index.html'));
    else await window.loadURL('http://127.0.0.1:4179');
    await new Promise(resolve => setTimeout(resolve, 1800));
    const result = await window.webContents.executeJavaScript(`({
      title: document.querySelector('.brand-copy strong')?.textContent,
      tabs: document.querySelectorAll('.workspace-nav button').length,
      cards: document.querySelectorAll('.card').length,
      hasMap: Boolean(document.querySelector('.leaflet-container')),
      bodyText: document.body.innerText.slice(0, 300)
    })`);
    if (result.title !== 'Global Road Test Studio') errors.push('Workbench title was not rendered');
    if (result.tabs !== 5) errors.push(`Expected 5 workspaces, found ${result.tabs}`);
    if (!result.cards) errors.push('No React cards rendered');
    if (!result.hasMap) errors.push('Leaflet map did not mount');
    const interaction = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.template-grid button')?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const projectCreated = Boolean(document.querySelector('.readiness-card'));
      document.querySelectorAll('.workspace-nav button')[1]?.click();
      await new Promise(resolve => setTimeout(resolve, 80));
      const coverageOpened = document.body.innerText.includes('区域智能规划');
      document.querySelectorAll('.workspace-nav button')[3]?.click();
      await new Promise(resolve => setTimeout(resolve, 80));
      const manualOpened = document.body.innerText.includes('手工路线');
      return { projectCreated, coverageOpened, manualOpened };
    })()`);
    if (!interaction.projectCreated) errors.push('Compliance project creation failed');
    if (!interaction.coverageOpened) errors.push('Coverage workspace switch failed');
    if (!interaction.manualOpened) errors.push('Manual-route workspace switch failed');
    if (errors.length) failed = true;
    process.stdout.write(`${JSON.stringify({ ...result, ...interaction, errors }, null, 2)}\n`);
    window.destroy();
  } catch (error) {
    failed = true;
    process.stderr.write(`${error.stack || error.message}\n`);
  } finally {
    vite?.kill();
    app.exit(failed ? 1 : 0);
  }
});

app.on('window-all-closed', event => event.preventDefault());

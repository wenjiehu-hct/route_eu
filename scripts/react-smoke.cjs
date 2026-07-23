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
    const window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { contextIsolation: true, sandbox: true } });
    window.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      failed = true;
      errors.push(`Renderer exited: ${details.reason}`);
    });
    if (useDist) await window.loadFile(path.join(root, 'dist', 'index.html'));
    else await window.loadURL('http://127.0.0.1:4179');
    await new Promise(resolve => setTimeout(resolve, 1200));
    const result = await window.webContents.executeJavaScript(`({
      title: document.querySelector('.platform-brand strong')?.textContent,
      navItems: document.querySelectorAll('.platform-nav a').length,
      statCards: document.querySelectorAll('.stat-card').length,
      hasDashboard: Boolean(document.querySelector('.dashboard-page')),
      bodyText: document.body.innerText.slice(0, 300)
    })`);
    if (result.title !== 'Global Road Test') errors.push('Platform brand was not rendered');
    if (result.navItems !== 7) errors.push(`Expected 7 platform navigation items, found ${result.navItems}`);
    if (result.statCards !== 4) errors.push(`Expected 4 dashboard stat cards, found ${result.statCards}`);
    if (!result.hasDashboard) errors.push('Portfolio dashboard did not render');
    const interaction = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.topbar-actions .primary')?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      const createPanelOpened = Boolean(document.querySelector('.create-project-panel'));
      document.querySelector('.create-project-panel .toolbar-row .button-primary')?.click();
      await new Promise(resolve => setTimeout(resolve, 120));
      const projectCreated = Boolean(document.querySelector('.project-command-strip'));
      document.querySelectorAll('.project-tabs button')[2]?.click();
      await new Promise(resolve => setTimeout(resolve, 80));
      document.querySelector('.execution-panel .card-actions .button-primary')?.click();
      await new Promise(resolve => setTimeout(resolve, 80));
      const runCreated = Boolean(document.querySelector('.run-card'));
      document.querySelectorAll('.project-tabs button')[3]?.click();
      await new Promise(resolve => setTimeout(resolve, 80));
      document.querySelector('.issues-panel .card-actions .button-primary')?.click();
      await new Promise(resolve => setTimeout(resolve, 80));
      const issueCreated = Boolean(document.querySelector('.issue-card'));
      document.querySelector('.platform-nav a[href="#/routes"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 400));
      const routeCenterOpened = Boolean(document.querySelector('.route-assets-page'));
      const routeMapMounted = Boolean(document.querySelector('.leaflet-container'));
      document.querySelector('.platform-nav a[href="#/planning"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 250));
      const planningOpened = Boolean(document.querySelector('.planning-page'));
      return { createPanelOpened, projectCreated, runCreated, issueCreated, routeCenterOpened, routeMapMounted, planningOpened };
    })()`);
    if (!interaction.createPanelOpened) errors.push('Project creation panel failed to open');
    if (!interaction.projectCreated) errors.push('Project creation failed');
    if (!interaction.runCreated) errors.push('Test run creation failed');
    if (!interaction.issueCreated) errors.push('Issue creation failed');
    if (!interaction.routeCenterOpened || !interaction.routeMapMounted) errors.push('Route asset center or map failed to mount');
    if (!interaction.planningOpened) errors.push('Planning center failed to open');
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

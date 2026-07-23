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
    const window = new BrowserWindow({ show: false, width: Number(process.env.SMOKE_WIDTH) || 1440, height: 960, webPreferences: { contextIsolation: true, sandbox: true } });
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
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase('globalRoadTestWorkspace'); request.onsuccess = () => { localStorage.setItem('routePlannerVue.groups.v1', JSON.stringify([{ id: 'smoke-group', name: 'Smoke routes', expanded: true, routes: [{ id: 'route-smoke', name: 'Smoke waypoint route', color: '#2563eb', visible: true, stops: [{ name: 'A', lat: 48.13, lon: 11.57 }, { name: 'B', lat: 48.18, lon: 11.62 }], stats: { distance: 12000, duration: 900, roadTypeDistances: { primary: 12000 } } }] }])); resolve(true); }; request.onerror = () => reject(request.error); })`);
    const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    window.reload();
    await reloaded;
    await new Promise(resolve => setTimeout(resolve, 1200));
    const interaction = await window.webContents.executeJavaScript(`(async () => {
      const waitFor = async selector => {
        for (let index = 0; index < 30; index += 1) {
          if (document.querySelector(selector)) return true;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
      };
      const waitUntil = async predicate => {
        for (let index = 0; index < 50; index += 1) {
          if (predicate()) return true;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return false;
      };
      document.querySelector('.topbar-actions .primary')?.click();
      const createPanelOpened = await waitFor('.create-project-panel');
      document.querySelector('.create-project-panel .toolbar-row .button-primary')?.click();
      const projectCreated = await waitFor('.project-command-strip');
      const projectReadinessVisible = Boolean(document.querySelector('.project-readiness-card .readiness-dimensions') && document.querySelector('.project-command-strip')?.textContent?.includes('交付进度'));
      const readinessGauge = document.querySelector('.readiness-gauge');
      const readinessStrip = document.querySelector('.project-command-strip');
      const readinessCard = document.querySelector('.project-readiness-card');
      const readinessLayoutStable = Boolean(readinessGauge && getComputedStyle(readinessGauge).position === 'relative' && readinessStrip.scrollWidth <= readinessStrip.clientWidth + 1 && readinessCard.scrollWidth <= readinessCard.clientWidth + 1);
      document.querySelectorAll('.project-tabs button')[2]?.click();
      await waitFor('.execution-panel');
      document.querySelector('.execution-panel .card-actions .button-primary')?.click();
      const runCreated = await waitFor('.run-card');
      if (!await waitFor('.run-editor')) {
        document.querySelector('.run-card footer button.button-secondary')?.click();
        await waitFor('.run-editor');
      }
      const setValue = (element, value) => {
        const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
        element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      };
      const runEditor = document.querySelector('.run-editor');
      const routeSelect = [...runEditor.querySelectorAll('label')].find(label => label.querySelector('span')?.textContent === '测试路线')?.querySelector('select');
      const driverInput = [...runEditor.querySelectorAll('label')].find(label => label.querySelector('span')?.textContent === '驾驶员')?.querySelector('input');
      const vehicleInput = [...runEditor.querySelectorAll('label')].find(label => label.querySelector('span')?.textContent === '车辆 / 版本')?.querySelector('input');
      setValue(routeSelect, 'route-smoke');
      setValue(driverInput, 'Smoke driver');
      setValue(vehicleInput, 'Smoke vehicle');
      await new Promise(resolve => setTimeout(resolve, 50));
      document.querySelector('.run-card footer a.button-primary')?.click();
      const sessionOpened = await waitFor('.test-session-page');
      const startGuidanceVisible = Boolean(document.querySelector('.session-controls .button-primary:not([disabled])')?.textContent?.includes('完成准备') && document.querySelector('.session-warning'));
      for (let index = 0; index < 5; index += 1) {
        document.querySelector('.preflight-list input:not(:checked)')?.click();
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const startReady = await waitFor('.session-controls .button-primary');
      const startButton = document.querySelector('.session-controls .button-primary');
      const startActionAvailable = startReady && startButton?.textContent?.includes('开始测试') && !startButton.disabled;
      startButton?.click();
      const runStarted = await waitFor('.session-controls .button-secondary');
      let evidenceUploaded = false;
      if (sessionOpened) {
        const input = document.querySelector('.session-main .evidence-manager input[type="file"]');
        const transfer = new DataTransfer();
        transfer.items.add(new File(['sample evidence'], 'sample.log', { type: 'text/plain' }));
        Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        evidenceUploaded = await waitFor('.session-main .evidence-files article');
      }
      window.history.back();
      await waitFor('.project-tabs');
      document.querySelectorAll('.project-tabs button')[3]?.click();
      await waitFor('.issues-panel');
      document.querySelector('.issues-panel .card-actions .button-primary')?.click();
      const issueCreated = await waitFor('.issue-card');
      document.querySelector('.platform-nav a[href="#/routes"]')?.click();
      const routeCenterOpened = await waitFor('.route-assets-page');
      const routeMapMounted = await waitFor('.leaflet-container');
      document.querySelector('.platform-nav a[href="#/planning"]')?.click();
      const planningOpened = await waitFor('.planning-page');
      const waypointModeDefault = document.querySelector('.planning-methods button.active strong')?.textContent?.includes('Waypoint');
      document.querySelector('.platform-nav a[href="#/data"]')?.click();
      const dataCenterOpened = await waitFor('.data-page');
      const localDatabaseReady = Boolean(document.querySelector('.local-database-card')?.textContent?.includes('IndexedDB'));
      const snapshotInput = document.querySelector('.snapshot-composer input');
      if (snapshotInput) setValue(snapshotInput, 'Smoke persistence snapshot');
      document.querySelector('.snapshot-composer .button-primary')?.click();
      const snapshotCreated = await waitUntil(() => [...document.querySelectorAll('.snapshot-history > div')].some(row => row.textContent.includes('Smoke persistence snapshot')));
      const localDataPersisted = await new Promise(resolve => {
        const request = indexedDB.open('globalRoadTestWorkspace');
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('workspace', 'readonly').objectStore('workspace').get('current');
          read.onsuccess = () => { const payload = read.result?.payload; resolve(Boolean(payload?.groups?.some(group => group.routes?.some(route => route.id === 'route-smoke')) && payload?.compliance?.projects?.length)); db.close(); };
          read.onerror = () => { resolve(false); db.close(); };
        };
        request.onerror = () => resolve(false);
      });
      return { createPanelOpened, projectCreated, projectReadinessVisible, readinessLayoutStable, runCreated, sessionOpened, startGuidanceVisible, startActionAvailable, runStarted, evidenceUploaded, issueCreated, routeCenterOpened, routeMapMounted, planningOpened, waypointModeDefault, dataCenterOpened, localDatabaseReady, snapshotCreated, localDataPersisted };
    })()`);
    if (!interaction.createPanelOpened) errors.push('Project creation panel failed to open');
    if (!interaction.projectCreated) errors.push('Project creation failed');
    if (!interaction.projectReadinessVisible) errors.push('Project readiness breakdown or delivery progress is missing');
    if (!interaction.readinessLayoutStable) errors.push('Project readiness layout overflows or gauge positioning is unstable');
    if (!interaction.runCreated) errors.push('Test run creation failed');
    if (!interaction.sessionOpened) errors.push('Live test session failed to open');
    if (!interaction.startGuidanceVisible) errors.push('Test run preparation guidance is missing or start control is disabled');
    if (!interaction.startActionAvailable || !interaction.runStarted) errors.push('Prepared test run could not be started');
    if (!interaction.evidenceUploaded) errors.push('IndexedDB evidence upload failed');
    if (!interaction.issueCreated) errors.push('Issue creation failed');
    if (!interaction.routeCenterOpened || !interaction.routeMapMounted) errors.push('Route asset center or map failed to mount');
    if (!interaction.planningOpened) errors.push('Planning center failed to open');
    if (!interaction.waypointModeDefault) errors.push('Waypoint planning is not the default planning mode');
    if (!interaction.dataCenterOpened || !interaction.localDatabaseReady) errors.push('Local workspace database center failed to open');
    if (!interaction.snapshotCreated || !interaction.localDataPersisted) errors.push('Local snapshot or IndexedDB persistence failed');
    const persistenceReloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    window.reload();
    await persistenceReloaded;
    await new Promise(resolve => setTimeout(resolve, 1200));
    const workspaceRestoredAfterReload = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('.platform-nav a[href="#/projects"]')?.click();
      for (let index = 0; index < 30; index += 1) {
        if (document.querySelector('.project-table-row, .project-card')) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    })()`);
    if (!workspaceRestoredAfterReload) errors.push('IndexedDB workspace was not restored after reload');
    if (errors.length) failed = true;
    process.stdout.write(`${JSON.stringify({ ...result, ...interaction, workspaceRestoredAfterReload, errors }, null, 2)}\n`);
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

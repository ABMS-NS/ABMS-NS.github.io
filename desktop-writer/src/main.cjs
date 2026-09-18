// Aplicativo desktop do Writer (Electron).
//
// Empacota o mesmo servidor dos outros, rodando no processo principal
// (onde o safeStorage do sistema está disponível para criptografar o
// arquivo de senha). A interface é a mesma: uma janela que aponta para
// http://127.0.0.1:<porta>.
//
// Segurança da janela: contextIsolation + sandbox ligados e sem
// nodeIntegration/ preload — o conteúdo carregado é o próprio Writer.

const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Em produção o bundle do servidor vem empacotado como extraResource;
// em desenvolvimento usamos o dist/ do workspace writer.
function writerDist() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'writer-dist');
  }
  return path.join(__dirname, '..', 'apps', 'writer', 'dist');
}

function hasContent(root) {
  try {
    return fs.existsSync(path.join(root, 'content'));
  } catch {
    return false;
  }
}

function walkToRepo(start) {
  let dir = start;
  for (;;) {
    if (hasContent(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function storedRepoPath() {
  try {
    const data = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'));
    return typeof data.repoPath === 'string' ? data.repoPath : null;
  } catch {
    return null;
  }
}

function saveRepoPath(repo) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify({ repoPath: repo }));
  } catch {
    /* sem persistência, seguimos sem memoria da última pasta */
  }
}

async function main() {
  await app.whenReady();

  // A senha e a configuração ficam no userData do app (criptografadas
  // pelo safeStorage do SO quando disponível). O bundle do servidor
  // lê WRITER_DATA_DIR/WRITER_REPO_ROOT do ambiente.
  process.env.WRITER_DATA_DIR = app.getPath('userData');

  let repo =
    process.env.WRITER_REPO_ROOT ||
    storedRepoPath() ||
    walkToRepo(process.cwd());

  if (!repo || !hasContent(repo)) {
    const pick = await dialog.showOpenDialog({
      title: 'Escolha a pasta do seu arquivo (com a pasta content/)',
      buttonLabel: 'Usar esta pasta',
      properties: ['openDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) {
      app.quit();
      return;
    }
    repo = pick.filePaths[0];
    saveRepoPath(repo);
  }

  const { startWriterServer } = require(path.join(writerDist(), 'writer.cjs'));

  const port = Number(process.env.WRITER_PORT ?? 4394);
  const server = await startWriterServer({ port, repoRoot: repo });

  // Permite trocar de pasta dentro do Writer (POST /api/workspace)
  // sem reiniciar o app: o servidor chama este callback.
  global.__writerWorkspacePicker = async () => {
    const pick = await dialog.showOpenDialog({
      title: 'Escolha a nova pasta do seu arquivo',
      properties: ['openDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return '';
    const chosen = pick.filePaths[0];
    saveRepoPath(chosen);
    return chosen;
  };

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Arquivo Writer',
    backgroundColor: '#050708',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await win.loadURL(`http://127.0.0.1:${port}`);
  win.on('closed', () => {
    try {
      server.close();
    } catch {
      /* processo em encerramento */
    }
  });
}

main().catch((err) => {
  console.error(err);
  dialog.showErrorBox('Writer', String(err && err.message ? err.message : err));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
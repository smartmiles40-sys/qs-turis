// Bolinha do QS — app de área de trabalho (Electron), estilo "AssistiveTouch".
//
// Por quê existe: a bolinha de avisos do QS só vive dentro da aba do navegador.
// Quem trabalha com o QS minimizado (Bitrix, WhatsApp, planilha na frente)
// perde o aviso. Aqui a bolinha flutua POR CIMA DE TODAS AS JANELAS do Windows,
// pode ser arrastada pra qualquer canto e abre um painel pequeno de atalhos.
//
// Divisão de responsabilidades (contrato com o lado web):
//   - Este arquivo é só a "casca": janela sem moldura, transparente, sempre no
//     topo, que carrega `${QS_URL}/?bolinha=1`. O CONTEÚDO (bolinha + painel)
//     é uma página do próprio QS (src/bolinha/ no app web).
//   - A página conversa com a casca via `window.qsDesktop` (ver preload.js):
//     expandir/recolher, arrastar, abrir uma tela no QS do navegador, sair.
//   - Login: a sessão do Supabase fica no localStorage de uma partição
//     PERSISTENTE ('persist:qs-bolinha'), então sobrevive a reinícios.
//
// Segurança: só navega dentro da origem do QS_URL; qualquer outro link abre no
// navegador padrão (só https). Nada de janelas novas. Permissões: só
// notificação e escrita na área de transferência.
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  screen,
  shell,
  session,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
const URL_PADRAO = "https://qs.setuforeuvouviagens.com.br";
const argUrl = process.argv.find((a) => a.startsWith("--url="));
const QS_URL = String((argUrl && argUrl.slice("--url=".length)) || process.env.QS_URL || URL_PADRAO).replace(/\/+$/, "");
const QS_ORIGEM = new URL(QS_URL).origin;
const URL_BOLINHA = `${QS_URL}/?bolinha=1`;

const BOLINHA = { width: 64, height: 64 };
const PAINEL = { width: 380, height: 560 };
const MARGEM = 24; // distância da borda na posição inicial
const PARTICAO = "persist:qs-bolinha";
const TENTAR_DE_NOVO_MS = 30 * 1000;
const ATUALIZAR_A_CADA_MS = 6 * 60 * 60 * 1000;

// Sem isso o Windows não mostra as notificações nativas (toast) do app.
if (process.platform === "win32") app.setAppUserModelId("br.com.setuforeuvou.qsbolinha");

// ---------------------------------------------------------------------------
// Preferências salvas (posição da bolinha, iniciar com o Windows)
// ---------------------------------------------------------------------------
const arquivoPrefs = () => path.join(app.getPath("userData"), "bolinha.json");
function lerPrefs() {
  try {
    return JSON.parse(fs.readFileSync(arquivoPrefs(), "utf8")) || {};
  } catch {
    return {};
  }
}
function salvarPrefs(mudancas) {
  const atual = { ...lerPrefs(), ...mudancas };
  try {
    fs.mkdirSync(path.dirname(arquivoPrefs()), { recursive: true });
    fs.writeFileSync(arquivoPrefs(), JSON.stringify(atual, null, 2));
  } catch (e) {
    console.error("[bolinha] não consegui salvar as preferências:", e);
  }
  return atual;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let janela = null;
let bandeja = null;
let estado = "bolinha"; // 'bolinha' | 'painel'
let posicaoBolinha = null; // {x, y} — onde a bolinha fica (volta pra cá ao recolher)
let saindo = false;
let mostrandoOffline = false;
let timerTentarDeNovo = null;
let arrasto = null; // { timer, dx, dy, inicio }

// Posição inicial: canto inferior direito da área útil do monitor principal.
function posicaoPadrao() {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: area.x + area.width - BOLINHA.width - MARGEM, y: area.y + area.height - BOLINHA.height - MARGEM };
}

// A posição salva só vale se a bolinha ainda cabe inteira em algum monitor
// (o notebook pode ter sido desconectado do monitor externo).
function posicaoValida(p) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  return screen.getAllDisplays().some(({ workArea: a }) =>
    p.x >= a.x && p.y >= a.y && p.x + BOLINHA.width <= a.x + a.width && p.y + BOLINHA.height <= a.y + a.height,
  );
}

// setBounds com largura/altura explícitas: em tela com escala (125%, 150%)
// o setPosition sozinho faz janela transparente "crescer" a cada movimento.
function posicionar(x, y, tam) {
  if (!janela) return;
  janela.setBounds({ x: Math.round(x), y: Math.round(y), width: tam.width, height: tam.height });
}

function avisarEstado() {
  if (janela && !janela.isDestroyed()) janela.webContents.send("qs:estado", estado);
}

// ---------------------------------------------------------------------------
// Expandir / recolher
// ---------------------------------------------------------------------------
function expandir() {
  if (!janela || estado === "painel") return;
  pararArrasto();
  const b = janela.getBounds();
  posicaoBolinha = { x: b.x, y: b.y };
  const area = screen.getDisplayMatching(b).workArea;
  const centroX = b.x + b.width / 2;
  const centroY = b.y + b.height / 2;
  // Ancorado no lado da bolinha: na metade direita cresce pra esquerda,
  // na metade de baixo cresce pra cima.
  let x = centroX > area.x + area.width / 2 ? b.x + b.width - PAINEL.width : b.x;
  let y = centroY > area.y + area.height / 2 ? b.y + b.height - PAINEL.height : b.y;
  // E nunca sai da área útil do monitor (nem por baixo da barra de tarefas).
  x = Math.min(Math.max(x, area.x), area.x + area.width - PAINEL.width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - PAINEL.height);
  estado = "painel";
  posicionar(x, y, PAINEL);
  janela.focus();
  avisarEstado();
}

function recolher() {
  if (!janela || estado === "bolinha") return;
  pararArrasto();
  const p = posicaoValida(posicaoBolinha) ? posicaoBolinha : posicaoPadrao();
  estado = "bolinha";
  posicionar(p.x, p.y, BOLINHA);
  avisarEstado();
}

// ---------------------------------------------------------------------------
// Arrastar: a página avisa mousedown/mouseup; quem move a janela é o main,
// seguindo o cursor a cada ~16ms (60 fps) e mantendo o "pega" do clique.
// Travas de segurança: para sozinho depois de 10s ou se a janela perder o foco
// (mouseup que escapou pra outra janela não deixa a bolinha grudada no mouse).
// ---------------------------------------------------------------------------
function arrastarInicio() {
  if (!janela) return;
  pararArrasto();
  const cursor = screen.getCursorScreenPoint();
  const b = janela.getBounds();
  const tam = { width: b.width, height: b.height };
  arrasto = {
    dx: cursor.x - b.x,
    dy: cursor.y - b.y,
    inicio: Date.now(),
    timer: setInterval(() => {
      if (!janela || Date.now() - arrasto.inicio > 10000) return arrastarFim();
      const c = screen.getCursorScreenPoint();
      posicionar(c.x - arrasto.dx, c.y - arrasto.dy, tam);
    }, 16),
  };
}

function pararArrasto() {
  if (!arrasto) return false;
  clearInterval(arrasto.timer);
  arrasto = null;
  return true;
}

function arrastarFim() {
  if (!pararArrasto() || !janela) return;
  const b = janela.getBounds();
  if (estado !== "bolinha") return; // painel arrastado: a bolinha volta pro lugar dela ao recolher
  // Soltou meio fora da tela? Puxa de volta pra dentro do monitor mais próximo.
  const area = screen.getDisplayMatching(b).workArea;
  const x = Math.min(Math.max(b.x, area.x), area.x + area.width - BOLINHA.width);
  const y = Math.min(Math.max(b.y, area.y), area.y + area.height - BOLINHA.height);
  if (x !== b.x || y !== b.y) posicionar(x, y, BOLINHA);
  posicaoBolinha = { x, y };
  salvarPrefs({ x, y });
}

// ---------------------------------------------------------------------------
// Sem internet: mostra uma bolinha local (offline.html) e tenta de novo a cada 30s
// ---------------------------------------------------------------------------
function carregarQS() {
  if (!janela) return;
  mostrandoOffline = false;
  janela.loadURL(URL_BOLINHA).catch(() => {}); // a falha é tratada no did-fail-load
}

function mostrarOffline() {
  if (!janela || mostrandoOffline) return;
  mostrandoOffline = true;
  recolher();
  janela.loadFile(path.join(__dirname, "offline.html")).catch(() => {});
  agendarNovaTentativa();
}

function agendarNovaTentativa() {
  clearTimeout(timerTentarDeNovo);
  timerTentarDeNovo = setTimeout(tentarDeNovo, TENTAR_DE_NOVO_MS);
}

// Antes de trocar a página, confere se o QS responde — assim a bolinha offline
// não "pisca" a cada tentativa enquanto a internet continua fora.
async function tentarDeNovo() {
  clearTimeout(timerTentarDeNovo);
  if (!janela || !mostrandoOffline) return;
  try {
    const r = await session.fromPartition(PARTICAO).fetch(QS_URL, { method: "HEAD", cache: "no-store" });
    if (r.status < 500) return carregarQS();
  } catch {
    /* continua offline */
  }
  agendarNovaTentativa();
}

// ---------------------------------------------------------------------------
// Janela
// ---------------------------------------------------------------------------
function ehDoQS(url) {
  try {
    return new URL(url).origin === QS_ORIGEM;
  } catch {
    return false;
  }
}
function abrirFora(url) {
  try {
    if (new URL(url).protocol === "https:") shell.openExternal(url);
  } catch {
    /* URL inválida: ignora */
  }
}

function criarJanela() {
  const salva = lerPrefs();
  const p = posicaoValida(salva) ? { x: salva.x, y: salva.y } : posicaoPadrao();
  posicaoBolinha = p;

  janela = new BrowserWindow({
    x: p.x,
    y: p.y,
    width: BOLINHA.width,
    height: BOLINHA.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    title: "Bolinha do QS",
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      partition: PARTICAO,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false, // avisos precisam chegar mesmo com a bolinha "parada"
    },
  });
  janela.setMenu(null);
  // 'screen-saver' = nível mais alto: fica por cima até de app em tela cheia "falsa".
  janela.setAlwaysOnTop(true, "screen-saver");

  janela.once("ready-to-show", () => janela.show());

  // Fechar (Alt+F4) só esconde; sair de verdade é pelo menu da bandeja ou qsDesktop.sair().
  janela.on("close", (e) => {
    if (!saindo) {
      e.preventDefault();
      janela.hide();
    }
  });
  janela.on("blur", () => {
    if (arrasto) arrastarFim();
  });

  const wc = janela.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    abrirFora(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (ehDoQS(url)) return;
    e.preventDefault();
    abrirFora(url);
  });
  wc.on("did-fail-load", (_e, codigo, _descricao, url, ehPrincipal) => {
    // -3 = navegação abortada (ex.: troca de rota) — não é falta de internet.
    if (!ehPrincipal || codigo === -3 || !ehDoQS(url)) return;
    mostrarOffline();
  });
  wc.on("render-process-gone", () => {
    if (!saindo) setTimeout(carregarQS, 2000);
  });

  carregarQS();
}

// ---------------------------------------------------------------------------
// Bandeja do Windows (perto do relógio)
// ---------------------------------------------------------------------------
function iniciaComWindows() {
  return app.getLoginItemSettings().openAtLogin;
}

function montarMenuBandeja() {
  if (!bandeja) return;
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mostrar bolinha", click: mostrarBolinha },
      { label: "Abrir o QS", click: () => shell.openExternal(QS_URL) },
      { type: "separator" },
      {
        label: "Iniciar com o Windows",
        type: "checkbox",
        checked: iniciaComWindows(),
        enabled: app.isPackaged, // em modo dev registraria o electron.exe, não o app
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
          salvarPrefs({ iniciarComWindows: item.checked });
        },
      },
      { type: "separator" },
      { label: `Versão ${app.getVersion()}`, enabled: false },
      { label: "Sair", click: sair },
    ]),
  );
}

function criarBandeja() {
  bandeja = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")));
  bandeja.setToolTip("Bolinha do QS");
  bandeja.on("click", mostrarBolinha);
  montarMenuBandeja();
}

function mostrarBolinha() {
  if (!janela) return;
  if (estado === "bolinha" && !posicaoValida(janela.getBounds())) {
    const p = posicaoPadrao();
    posicaoBolinha = p;
    posicionar(p.x, p.y, BOLINHA);
    salvarPrefs(p);
  }
  janela.show();
  janela.setAlwaysOnTop(true, "screen-saver");
}

function sair() {
  saindo = true;
  pararArrasto();
  app.quit();
}

// ---------------------------------------------------------------------------
// Atualização automática (GitHub Releases do repo qs-turis)
// Confere ao abrir e a cada 6h; baixa sozinho e instala quando o app fechar.
// ---------------------------------------------------------------------------
function configurarAtualizacao() {
  if (!app.isPackaged) return; // em dev não há o que atualizar
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (e) {
    console.error("[bolinha] electron-updater indisponível:", e);
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (e) => console.error("[bolinha] atualização falhou:", e && e.message));
  const conferir = () => autoUpdater.checkForUpdates().catch((e) => console.error("[bolinha] atualização:", e && e.message));
  conferir();
  setInterval(conferir, ATUALIZAR_A_CADA_MS);
}

// ---------------------------------------------------------------------------
// Ponte com a página (ver preload.js)
// ---------------------------------------------------------------------------
function registrarIPC() {
  // Só aceita mensagens da nossa janela.
  const daBolinha = (e) => janela && e.sender === janela.webContents;
  ipcMain.on("qs:versao", (e) => {
    e.returnValue = app.getVersion();
  });
  ipcMain.on("qs:expandir", (e) => daBolinha(e) && expandir());
  ipcMain.on("qs:recolher", (e) => daBolinha(e) && recolher());
  ipcMain.handle("qs:estado", () => estado);
  ipcMain.on("qs:arrastar-inicio", (e) => daBolinha(e) && arrastarInicio());
  ipcMain.on("qs:arrastar-fim", (e) => daBolinha(e) && arrastarFim());
  ipcMain.on("qs:abrir-no-qs", (e, hash) => {
    if (!daBolinha(e)) return;
    if (typeof hash !== "string" || !hash.startsWith("#") || hash.length > 500) return;
    shell.openExternal(`${QS_URL}/${hash}`);
  });
  ipcMain.on("qs:tentar-de-novo", (e) => daBolinha(e) && tentarDeNovo());
  ipcMain.on("qs:sair", (e) => daBolinha(e) && sair());
}

// ---------------------------------------------------------------------------
// Permissões: só notificação e copiar pra área de transferência
// ---------------------------------------------------------------------------
const PERMITIDAS = new Set(["notifications", "clipboard-sanitized-write"]);
function configurarSessao() {
  const ses = session.fromPartition(PARTICAO);
  ses.setPermissionRequestHandler((_wc, permissao, responder) => responder(PERMITIDAS.has(permissao)));
  ses.setPermissionCheckHandler((_wc, permissao) => PERMITIDAS.has(permissao));
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // já tem uma bolinha aberta — a outra instância se mostra (second-instance)
} else {
  app.on("second-instance", mostrarBolinha);

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Primeira vez: liga "Iniciar com o Windows" por padrão.
    const prefs = lerPrefs();
    if (app.isPackaged && prefs.iniciarComWindows === undefined) {
      app.setLoginItemSettings({ openAtLogin: true });
      salvarPrefs({ iniciarComWindows: true });
    }
    configurarSessao();
    registrarIPC();
    criarJanela();
    criarBandeja();
    configurarAtualizacao();

    // Monitor desligado/trocado: se a bolinha ficou fora da tela, volta pro canto.
    const conferirTela = () => {
      if (!janela || estado !== "bolinha") return;
      if (!posicaoValida(janela.getBounds())) mostrarBolinha();
    };
    screen.on("display-removed", conferirTela);
    screen.on("display-metrics-changed", conferirTela);
  });

  app.on("before-quit", () => {
    saindo = true;
  });
  // A bolinha vive na bandeja: fechar janelas não encerra o app.
  app.on("window-all-closed", () => {
    if (saindo) app.quit();
  });
}

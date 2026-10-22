// Ponte entre a página do QS (/?bolinha=1) e a casca da Bolinha do QS.
//
// Por quê: a página roda isolada (contextIsolation + sandbox, sem Node), então
// ela só enxerga o que for exposto aqui em `window.qsDesktop`. Se
// `window.qsDesktop` não existir, a página sabe que está num navegador comum
// e não no app de área de trabalho.
//
// Contrato (combinado com src/bolinha/ no app web — não mudar sem mudar lá):
//   versao: string
//   expandir(): void          recolher(): void
//   estado(): Promise<'bolinha'|'menu'|'painel'>
//   menu(): void              (os 5 atalhos flutuando em volta da bolinha)
//   layout(): Promise<{ estado, cx, cy }>  (centro da bolinha dentro da janela)
//   clicavel(sim): void       (no menu: o mouse está em cima de um ícone?)
//   arrastarInicio(): void    arrastarFim(): void   (mousedown / mouseup na bolinha)
//   abrirNoQS(hash): void     (hash começando com '#', abre no navegador padrão)
//   sair(): void
//   onMudouEstado(cb): () => void   (devolve a função que cancela a inscrição)
// Extra (usado pela bolinha offline local): tentarDeNovo(): void
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qsDesktop", {
  versao: ipcRenderer.sendSync("qs:versao"),
  expandir: () => ipcRenderer.send("qs:expandir"),
  recolher: () => ipcRenderer.send("qs:recolher"),
  menu: () => ipcRenderer.send("qs:menu"),
  layout: () => ipcRenderer.invoke("qs:layout"),
  clicavel: (sim) => ipcRenderer.send("qs:clicavel", !!sim),
  estado: () => ipcRenderer.invoke("qs:estado"),
  arrastarInicio: () => ipcRenderer.send("qs:arrastar-inicio"),
  arrastarFim: () => ipcRenderer.send("qs:arrastar-fim"),
  abrirNoQS: (hash) => {
    if (typeof hash === "string" && hash.startsWith("#")) ipcRenderer.send("qs:abrir-no-qs", hash);
  },
  sair: () => ipcRenderer.send("qs:sair"),
  onMudouEstado: (cb) => {
    if (typeof cb !== "function") return () => {};
    const ouvinte = (_evento, e, info) => cb(e, info);
    ipcRenderer.on("qs:estado", ouvinte);
    return () => ipcRenderer.removeListener("qs:estado", ouvinte);
  },
  tentarDeNovo: () => ipcRenderer.send("qs:tentar-de-novo"),
});

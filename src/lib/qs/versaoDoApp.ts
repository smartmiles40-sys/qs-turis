// src/lib/qs/versaoDoApp.ts
// -----------------------------------------------------------------------------
// VIGIA DE VERSÃO — a aba descobre que saiu deploy novo ANTES de quebrar.
//
// O problema, que aconteceu duas vezes: a SDR deixa o QS aberto o dia inteiro.
// Sai um deploy. O index.html que a aba dela carregou de manhã aponta pra
// arquivos com hash antigo, que o build novo substituiu. Aí ela clica em Leads,
// em Análises, ou abre o seletor de emoji — e leva um erro que não tem nada a
// ver com o que ela estava fazendo.
//
// Recarregar DEPOIS da falha (o lazyPagina) conserta o sintoma. Isto ataca a
// causa: de tempos em tempos a aba pergunta ao servidor qual é o index.html
// atual e compara com o que ela carregou.
//
// Como decide a hora de atualizar, que é a parte delicada:
//  • aba ESCONDIDA (outra janela, celular bloqueado) → recarrega na hora.
//    Ninguém está olhando, não tem formulário no meio, é de graça.
//  • aba VISÍVEL → NÃO recarrega escondido. A SDR pode estar escrevendo uma
//    mensagem ou no meio de um desfecho; recarregar por baixo dela seria pior
//    que o problema. Mostra um aviso e ela escolhe quando.
//
// Sem dependência de React nem de build: descobre a versão atual lendo a própria
// tag <script> que o Vite injetou. Nada de arquivo de versão pra manter em dia.
// -----------------------------------------------------------------------------

const INTERVALO_MS = 5 * 60_000;
/** Só o nome do bundle principal muda a cada build — é a impressão digital. */
const RE_BUNDLE = /assets\/index-[A-Za-z0-9_-]+\.js/;

type Listener = (novaVersao: boolean) => void;
const listeners = new Set<Listener>();

let bundleAtual: string | null = null;
let novaVersaoDetectada = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** O bundle que ESTA aba carregou, lido da tag que o Vite injetou no HTML. */
function bundleDaAba(): string | null {
  if (bundleAtual) return bundleAtual;
  const tags = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'));
  for (const t of tags) {
    const m = t.getAttribute("src")?.match(RE_BUNDLE);
    if (m) { bundleAtual = m[0]; return bundleAtual; }
  }
  return null;
}

/** Pergunta ao servidor qual é o bundle do deploy atual. */
async function bundleDoServidor(): Promise<string | null> {
  try {
    // no-store é essencial: com o HTML vindo do cache do navegador, a resposta
    // seria sempre "está tudo igual" — justamente a versão velha que temos.
    const r = await fetch(`/?v=${Date.now()}`, { cache: "no-store", headers: { Accept: "text/html" } });
    if (!r.ok) return null;
    const html = await r.text();
    return html.match(RE_BUNDLE)?.[0] ?? null;
  } catch {
    // Rede caiu / offline: não é sinal de versão nova. Tenta de novo depois.
    return null;
  }
}

async function verificar(): Promise<void> {
  if (novaVersaoDetectada) return; // já sabemos; não adianta perguntar de novo
  const meu = bundleDaAba();
  if (!meu) return; // dev server / preview sem bundle hasheado: nada a vigiar
  const servidor = await bundleDoServidor();
  if (!servidor || servidor === meu) return;

  novaVersaoDetectada = true;
  if (document.hidden) {
    // Ninguém olhando: troca agora e a SDR nem percebe que houve deploy.
    window.location.reload();
    return;
  }
  listeners.forEach((l) => { try { l(true); } catch { /* um listener quebrado não derruba os outros */ } });
}

/**
 * Liga o vigia. Chamar UMA vez (SdrLayout). Devolve o desligamento.
 * Verifica ao ligar, a cada 5 min e sempre que a aba volta pro primeiro plano —
 * é nesse retorno que o SDR normalmente descobria o problema.
 */
export function vigiarVersao(onNovaVersao: Listener): () => void {
  listeners.add(onNovaVersao);
  if (novaVersaoDetectada) onNovaVersao(true);

  const aoVoltar = () => { if (!document.hidden) void verificar(); };
  if (!timer) {
    void verificar();
    timer = setInterval(() => void verificar(), INTERVALO_MS);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
  }

  return () => {
    listeners.delete(onNovaVersao);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    }
  };
}

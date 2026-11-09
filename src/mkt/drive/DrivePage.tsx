// src/mkt/drive/DrivePage.tsx — tela "Drive" da área Marketing (0241).
// Os arquivos moram no Drive compartilhado "Marketing" (Google); o QS navega,
// busca (índice local com tags), toca os vídeos e sobe arquivo sem ninguém
// precisar logar no Google.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConfigDrive, ItemDrive } from "./tipos";
import * as api from "./api";
import { Navegador } from "./Navegador";
import { Visualizador } from "./Visualizador";
import { Botao, Ic } from "./ui";

function haQuanto(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

export default function DrivePage() {
  const [config, setConfig] = useState<ConfigDrive | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<ItemDrive | null>(null);
  const [versao, setVersao] = useState(0);
  const [sincronizando, setSincronizando] = useState(false);
  const irParaRef = useRef<((p: string | null) => void) | null>(null);

  const lerConfig = useCallback(() => api.lerConfig().then(setConfig).catch((e) => setErro((e as Error).message)), []);
  useEffect(() => { void lerConfig(); }, [lerConfig]);

  const sincronizar = useCallback(async (silencioso = false) => {
    setSincronizando(true);
    try {
      // Pode precisar de várias rodadas na 1ª vez (Drive grande).
      for (let i = 0; i < 5; i++) {
        const r = await api.sincronizar();
        if (!r.pendente) break;
      }
      await lerConfig();
      setVersao((v) => v + 1);
    } catch (e) {
      if (!silencioso) setErro((e as Error).message);
    } finally { setSincronizando(false); }
  }, [lerConfig]);

  // Ao abrir: se a última sincronização tem mais de 15 min, roda uma em segundo plano.
  const jaSincronizou = useRef(false);
  useEffect(() => {
    if (!config?.configurado || jaSincronizou.current) return;
    jaSincronizou.current = true;
    const ult = config.estado?.ultima_sync ? new Date(config.estado.ultima_sync).getTime() : 0;
    if (Date.now() - ult > 15 * 60_000) void sincronizar(true);
  }, [config, sincronizar]);

  return (
    <div className="px-4 sm:px-6 py-5 max-w-[1400px] mx-auto w-full flex flex-col gap-4 min-w-0">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Drive</h1>
          <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
            Vídeos, fotos e conteúdos gravados do Marketing, no Drive compartilhado “{config?.raiz?.nome || "Marketing"}”.
          </p>
        </div>
        {config?.configurado && (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--ink3)" }}>
            <span title={config.estado?.ultimo_erro || undefined}>
              {config.estado?.varrendo ? "Indexando o Drive…" : `Índice atualizado ${haQuanto(config.estado?.ultima_sync)}`}
              {config.estado?.ultimo_erro ? " · último erro na sincronização" : ""}
            </span>
            <Botao onClick={() => void sincronizar(false)} disabled={sincronizando} aria-label="Atualizar índice">
              <span className={sincronizando ? "animate-spin" : ""}>{Ic.atualizar()}</span>
              <span className="hidden sm:inline">{sincronizando ? "Atualizando…" : "Atualizar"}</span>
            </Botao>
          </div>
        )}
      </header>

      {erro && (
        <p className="text-[13px] rounded-lg px-3 py-2" role="alert" style={{ background: "var(--err-bg)", color: "var(--err-ink)" }}>
          {/* 04/11/2026: sem config, fechar o erro deixava "Carregando…" pra sempre; aí o botão tenta de novo. */}
          {erro} <button type="button" className="underline ml-1" onClick={() => { setErro(null); if (!config) void lerConfig(); }}>{config ? "ok" : "tentar de novo"}</button>
        </p>
      )}

      {!config && !erro && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>}

      {config && (
        <Navegador
          modo="tela"
          config={config}
          versao={versao}
          onAbrir={(item, irPara) => { irParaRef.current = irPara; setAberto(item); }}
        />
      )}

      <Visualizador
        item={aberto}
        config={config}
        onFechar={() => setAberto(null)}
        onMudou={() => { setVersao((v) => v + 1); void lerConfig(); }}
        onIrParaPasta={(p) => irParaRef.current?.(p)}
      />
    </div>
  );
}

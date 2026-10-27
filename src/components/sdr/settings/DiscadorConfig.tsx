// src/components/sdr/settings/DiscadorConfig.tsx
// -----------------------------------------------------------------------------
// Configurações → Discador. Liga/desliga + tamanho do lote, tempo de toque e
// abandono máximo (qs_settings: discador_ativo / discador_config). Só gestor e
// admin conseguem salvar (RLS de qs_settings, 0011). Ver docs/DISCADOR.md.
// -----------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from "react";
import { carregarConfigDiscador, discadorLigado, salvarConfigDiscador } from "@/lib/discador/controlador";
import { CONFIG_PADRAO, LOTE_TETO, normalizarConfig, type ConfigDiscador } from "@/lib/discador/motor";
import { notifyError, notifySuccess } from "@/lib/qs/notify";

export default function DiscadorConfig() {
  const [ativo, setAtivo] = useState(false);
  const [cfg, setCfg] = useState<ConfigDiscador>(CONFIG_PADRAO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, c] = await Promise.all([discadorLigado(), carregarConfigDiscador()]);
      setAtivo(a);
      setCfg(c);
      setCarregando(false);
    })();
  }, []);

  async function salvar() {
    setSalvando(true);
    const limpa = normalizarConfig(cfg);
    const ok = await salvarConfigDiscador(ativo, limpa);
    setSalvando(false);
    if (ok) { setCfg(limpa); notifySuccess(ativo ? "Discador ligado." : "Discador salvo (desligado)."); }
    else notifyError("Não foi possível salvar — só gestor/admin pode mudar o discador.");
  }

  const campo = (rotulo: string, ajuda: string, el: ReactNode) => (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-800">{rotulo}</span>
      <span className="block text-xs text-gray-500 mb-1">{ajuda}</span>
      {el}
    </label>
  );
  const inputCls = "w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm";

  if (carregando) return <div className="text-sm text-gray-500">Carregando…</div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Discador</h2>
        <p className="text-sm text-gray-600 mt-1">
          Na Fila de hoje, o SDR clica em <b>Iniciar discagem</b>: o QS liga pra vários leads ao mesmo tempo pelo
          ramal dele. O primeiro que atender vem pro SDR; os outros são cancelados. Se dois atenderem juntos, o
          segundo é desligado e ganha um retorno urgente. Precisa do Webfone WebRTC configurado.
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        <span className="text-sm font-semibold text-gray-800">Discador ligado</span>
      </label>

      {campo("Chamadas por lote", `Quantas ligações saem ao mesmo tempo no começo (1 a ${cfg.loteMax}). Comece com pouco.`,
        <input type="number" min={1} max={cfg.loteMax} className={inputCls} value={cfg.lote}
          onChange={(e) => setCfg({ ...cfg, lote: Number(e.target.value) })} />)}

      {campo("Teto do lote", `Nunca passa disso (máximo ${LOTE_TETO}). Se a central aceitar menos, o discador descobre e baixa sozinho.`,
        <input type="number" min={1} max={LOTE_TETO} className={inputCls} value={cfg.loteMax}
          onChange={(e) => setCfg({ ...cfg, loteMax: Number(e.target.value) })} />)}

      {campo("Tempo de toque (segundos)", "Quanto tempo cada número toca antes de desistir — abaixo do tempo da caixa postal (8 a 45).",
        <input type="number" min={8} max={45} className={inputCls} value={cfg.toqueSeg}
          onChange={(e) => setCfg({ ...cfg, toqueSeg: Number(e.target.value) })} />)}

      {campo("Abandono máximo (%)", "Atenderam e foram derrubados ÷ atendidas. Passou disso, o lote cai pela metade.",
        <input type="number" min={0} max={50} step={0.5} className={inputCls} value={Math.round(cfg.abandonoMax * 1000) / 10}
          onChange={(e) => setCfg({ ...cfg, abandonoMax: Number(e.target.value) / 100 })} />)}

      <button
        onClick={() => void salvar()}
        disabled={salvando}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {salvando ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}

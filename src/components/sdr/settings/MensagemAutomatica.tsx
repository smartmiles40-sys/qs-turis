// src/components/sdr/settings/MensagemAutomatica.tsx
// -----------------------------------------------------------------------------
// MENSAGEM AUTOMÁTICA DE PRIMEIRO CONTATO
//
// Quem cai na etapa "primeiro contato" no Bitrix recebe o vídeo de
// apresentação. NÃO tem IA nenhuma aqui — é template aprovado da Meta,
// disparado pelo QS (`/api/primeiro-contato`).
//
// Antes isso vivia dentro de um workflow do n8n, apontando pro ChatApp: trocar
// a mensagem era editar JSON e reimportar workflow. Esta tela existe pra que
// trocar a mensagem seja trocar a mensagem.
//
// AS QUATRO DECISÕES SÃO DO BRUNO, NÃO DO CÓDIGO:
//   1. qual modelo aprovado
//   2. qual vídeo vai no cabeçalho (a Meta pede o link a cada envio; ele não
//      fica guardado no modelo)
//   3. quantos por dia, no máximo — cada conversa iniciada por template é
//      cobrada pela Meta, e campanha que escala de madrugada não pede licença
//   4. ligado ou desligado
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { listarModelosAdmin, type WaModeloAdmin } from "@/lib/qs/waInbox";
import { useQsAuth } from "@/contexts/QsAuthContext";

const CHAVE = "primeiro_contato_auto";

/** PRECISA bater com `montarParams` de api/primeiro-contato.js. */
const APELIDOS = [
  { valor: "{{primeiro_nome}}", label: "Primeiro nome", ajuda: "Bruno" },
  { valor: "{{nome}}", label: "Nome completo", ajuda: "Bruno Oliveira" },
  { valor: "{{expedicao}}", label: "Expedição/fonte do lead", ajuda: "vem do campo Fonte" },
  { valor: "{{empresa}}", label: "Nome da agência", ajuda: "Se Tu For, Eu Vou" },
];

interface Config {
  ativo?: boolean;
  teto_dia?: number;
  template?: { nome: string; idioma?: string | null; params?: Record<string, string> };
  midia?: { url?: string; tipo?: string };
}

export default function MensagemAutomatica() {
  const { currentUser } = useQsAuth();
  const podeMexer = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const [modelos, setModelos] = useState<WaModeloAdmin[]>([]);
  const [cfg, setCfg] = useState<Config>({ ativo: false, teto_dia: 200 });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [{ modelos: ms, error: eM }, { data }] = await Promise.all([
        listarModelosAdmin(),
        supabase.from("qs_settings").select("value").eq("key", CHAVE).maybeSingle(),
      ]);
      if (eM) setErro(eM);
      // Só APPROVED entra: oferecer modelo pendente é prometer um envio que a
      // Meta vai recusar na hora.
      setModelos((ms || []).filter((m) => String(m.status).toUpperCase() === "APPROVED"));
      if (data?.value) setCfg(data.value as Config);
    } catch (e: unknown) {
      setErro((e as { message?: string })?.message ?? "Não consegui carregar.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const escolhido = modelos.find((m) => m.nome === cfg.template?.nome) ?? null;
  // `cabecalhoMidia` vem do _meta.js: é o FORMATO do cabeçalho quando não é
  // texto (VIDEO, IMAGE, DOCUMENT). Se tem, o envio exige o link.
  const precisaMidia = !!escolhido?.cabecalhoMidia;
  const faltaMidia = precisaMidia && !cfg.midia?.url?.trim();
  const variaveis = escolhido?.variaveis ?? [];
  const faltaVariavel = variaveis.some((v) => !cfg.template?.params?.[v]);

  const salvar = useCallback(async () => {
    setSalvando(true);
    try {
      const value: Config = {
        ativo: !!cfg.ativo,
        teto_dia: Math.max(0, Math.floor(Number(cfg.teto_dia ?? 200))),
        template: cfg.template?.nome
          ? { nome: cfg.template.nome, idioma: cfg.template.idioma ?? null, params: cfg.template.params ?? {} }
          : undefined,
        midia: cfg.midia?.url?.trim()
          ? { url: cfg.midia.url.trim(), tipo: (escolhido?.cabecalhoMidia || "VIDEO").toLowerCase() }
          : undefined,
      };
      const { error } = await supabase.from("qs_settings").upsert([{ key: CHAVE, value }], { onConflict: "key" });
      if (error) throw error;
      notifySuccess("Mensagem automática salva.");
      await carregar();
    } catch (e: unknown) {
      notifyError((e as { message?: string })?.message ?? "Não consegui salvar.");
    } finally {
      setSalvando(false);
    }
  }, [cfg, escolhido, carregar]);

  if (carregando) return <p className="text-sm text-gray-500">Carregando…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Mensagem automática de primeiro contato</h2>
        <p className="mt-1 text-[13px] text-gray-600">
          Quem cai em <strong>primeiro contato</strong> no Bitrix recebe esta mensagem, uma vez só.
          O mesmo lead nunca recebe duas vezes, mesmo que o Bitrix repita o gatilho.
        </p>
      </div>

      {erro && <p className="rounded-md bg-amber-50 p-2 text-[13px] text-amber-800">{erro}</p>}

      {/* Liga/desliga */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!cfg.ativo}
          disabled={!podeMexer}
          onChange={(e) => setCfg((c) => ({ ...c, ativo: e.target.checked }))}
        />
        <span className="text-sm font-medium text-gray-900">Ligada</span>
        {!cfg.ativo && <span className="text-[12px] text-gray-500">— nada é disparado enquanto estiver desligada</span>}
      </label>

      {/* Modelo */}
      <div>
        <label className="block text-[13px] font-medium text-gray-800">Modelo aprovado na Meta</label>
        <select
          className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm"
          value={cfg.template?.nome ?? ""}
          disabled={!podeMexer}
          onChange={(e) => {
            const m = modelos.find((x) => x.nome === e.target.value);
            setCfg((c) => ({
              ...c,
              template: m ? { nome: m.nome, idioma: m.idioma, params: {} } : undefined,
            }));
          }}
        >
          <option value="">— escolha —</option>
          {modelos.map((m) => (
            <option key={m.nome + m.idioma} value={m.nome}>
              {m.nome} ({m.idioma}){m.cabecalhoMidia ? ` · cabeçalho ${m.cabecalhoMidia}` : ""}
            </option>
          ))}
        </select>
        {escolhido && (
          <p className="mt-1 whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-[13px] text-gray-700">{escolhido.corpo}</p>
        )}
      </div>

      {/* Mídia do cabeçalho */}
      {precisaMidia && (
        <div>
          <label className="block text-[13px] font-medium text-gray-800">
            Link do {String(escolhido?.cabecalhoMidia).toLowerCase()} do cabeçalho
          </label>
          <input
            type="url"
            className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm"
            placeholder="https://…/video.mp4"
            value={cfg.midia?.url ?? ""}
            disabled={!podeMexer}
            onChange={(e) => setCfg((c) => ({ ...c, midia: { ...c.midia, url: e.target.value } }))}
          />
          <p className="mt-1 text-[12px] text-gray-500">
            A Meta busca este arquivo a cada envio — ele não fica guardado no modelo.
            O link precisa ser público e continuar no ar.
          </p>
        </div>
      )}

      {/* Variáveis */}
      {variaveis.length > 0 && (
        <div>
          <p className="text-[13px] font-medium text-gray-800">Variáveis do modelo</p>
          {variaveis.map((v) => (
            <div key={v} className="mt-1 flex items-center gap-2">
              <span className="w-16 text-[13px] text-gray-600">{`{{${v}}}`}</span>
              <select
                className="flex-1 rounded-md border border-gray-300 p-2 text-sm"
                value={cfg.template?.params?.[v] ?? ""}
                disabled={!podeMexer}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    template: c.template
                      ? { ...c.template, params: { ...(c.template.params ?? {}), [v]: e.target.value } }
                      : c.template,
                  }))
                }
              >
                <option value="">— escolha —</option>
                {APELIDOS.map((a) => (
                  <option key={a.valor} value={a.valor}>{a.label} ({a.ajuda})</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Teto */}
      <div>
        <label className="block text-[13px] font-medium text-gray-800">Máximo por dia</label>
        <input
          type="number"
          min={0}
          className="mt-1 w-32 rounded-md border border-gray-300 p-2 text-sm"
          value={cfg.teto_dia ?? 200}
          disabled={!podeMexer}
          onChange={(e) => setCfg((c) => ({ ...c, teto_dia: Number(e.target.value) }))}
        />
        <p className="mt-1 text-[12px] text-gray-500">
          Bater o teto NÃO perde o lead: o disparo fica registrado como bloqueado e você vê na auditoria.
        </p>
      </div>

      {/* O que impede de ligar — dito antes de salvar, não depois de falhar */}
      {cfg.ativo && (faltaMidia || faltaVariavel || !cfg.template?.nome) && (
        <p className="rounded-md bg-amber-50 p-2 text-[13px] text-amber-800">
          {!cfg.template?.nome && "Escolha o modelo. "}
          {faltaMidia && "Este modelo tem cabeçalho de mídia e precisa do link. "}
          {faltaVariavel && "Falta mapear alguma variável — variável vazia faz a Meta recusar o template inteiro."}
        </p>
      )}

      {podeMexer ? (
        <button
          onClick={() => void salvar()}
          disabled={salvando}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar"}
        </button>
      ) : (
        <p className="text-[13px] text-gray-500">Só administrador ou gestor altera esta configuração.</p>
      )}
    </div>
  );
}

// src/components/sdr/settings/MensagemAutomatica.tsx
// -----------------------------------------------------------------------------
// MENSAGEM AUTOMÁTICA DE PRIMEIRO CONTATO
//
// Quem entra como lead novo recebe o vídeo de apresentação. NÃO tem IA nenhuma
// aqui — é template aprovado da Meta, disparado pelo QS.
//
// Antes isso vivia dentro de um workflow do n8n, apontando pro ChatApp: trocar
// a mensagem era editar JSON e reimportar workflow. Esta tela existe pra que
// trocar a mensagem seja trocar a mensagem.
//
// AS CINCO DECISÕES SÃO DO BRUNO, NÃO DO CÓDIGO:
//   1. QUANDO dispara — assim que o lead entra no QS, ou só quando o Bitrix
//      mandar (31/08: o QS passou a disparar sozinho; o Bitrix virou o plano B)
//   2. qual modelo aprovado
//   3. qual vídeo vai no cabeçalho (a Meta pede o link a cada envio; ele não
//      fica guardado no modelo)
//   4. quantos por dia, no máximo — cada conversa iniciada por template é
//      cobrada pela Meta, e campanha que escala de madrugada não pede licença
//   5. ligado ou desligado
//
// A PRÉVIA E O PAINEL EXISTEM PELO MESMO MOTIVO DA TELA. De nada adianta
// qualquer um poder trocar a mensagem se, pra saber o que vai sair e se saiu,
// ainda precisar chamar alguém: a prévia mostra o texto com as variáveis já
// preenchidas, e o painel mostra quantos saíram hoje e o que falhou.
// -----------------------------------------------------------------------------

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { listarModelosAdmin, type WaModeloAdmin } from "@/lib/qs/waInbox";
import { useQsAuth } from "@/contexts/QsAuthContext";

const CHAVE = "primeiro_contato_auto";

/**
 * PRECISA bater com `montarParams` de api/_primeiroContato.js. Apelido que só
 * existe de um lado vira variável vazia — e variável vazia faz a Meta recusar o
 * template inteiro.
 *
 * `exemplo` é só da prévia: é o que aparece no lugar da variável pra quem está
 * conferindo o texto antes de ligar.
 */
const APELIDOS = [
  { valor: "{{primeiro_nome}}", label: "Primeiro nome", ajuda: "Bruno", exemplo: "Bruno" },
  { valor: "{{nome}}", label: "Nome completo", ajuda: "Bruno Oliveira", exemplo: "Bruno Oliveira" },
  { valor: "{{expedicao}}", label: "Expedição/fonte do lead", ajuda: "vem do campo Fonte", exemplo: "Japão Outubro" },
  { valor: "{{empresa}}", label: "Nome da agência", ajuda: "Se Tu For, Eu Vou", exemplo: "Se Tu For, Eu Vou" },
];

type Gatilho = "lead_novo" | "externo";

interface Config {
  ativo?: boolean;
  gatilho?: Gatilho;
  teto_dia?: number;
  template?: { nome: string; idioma?: string | null; params?: Record<string, string> };
  midia?: { url?: string; tipo?: string };
}

interface Disparo {
  lead_id: string;
  status: string;
  motivo: string | null;
  origem: string | null;
  criado_em: string;
}

/** Meia-noite de hoje no fuso do time (não no do navegador de quem abriu). */
function inicioDoDiaSP(): string {
  const agora = new Date();
  const emSP = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const meiaNoite = new Date(emSP);
  meiaNoite.setHours(0, 0, 0, 0);
  return new Date(agora.getTime() - (emSP.getTime() - meiaNoite.getTime())).toISOString();
}

export default function MensagemAutomatica() {
  const { currentUser } = useQsAuth();
  const podeMexer = currentUser?.role === "admin" || currentUser?.role === "gestor";

  const [modelos, setModelos] = useState<WaModeloAdmin[]>([]);
  const [cfg, setCfg] = useState<Config>({ ativo: false, gatilho: "lead_novo", teto_dia: 200 });
  const [disparos, setDisparos] = useState<Disparo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [{ modelos: ms, error: eM }, { data }, { data: hist }] = await Promise.all([
        listarModelosAdmin(),
        supabase.from("qs_settings").select("value").eq("key", CHAVE).maybeSingle(),
        // O painel. A RLS da 0067 já limita o que cada um enxerga (gestão vê
        // tudo, SDR vê os leads dele), então não há filtro a fazer aqui.
        supabase
          .from("qs_primeiro_contato")
          .select("lead_id,status,motivo,origem,criado_em")
          .order("criado_em", { ascending: false })
          .limit(200),
      ]);
      if (eM) setErro(eM);
      // Só APPROVED entra: oferecer modelo pendente é prometer um envio que a
      // Meta vai recusar na hora.
      setModelos((ms || []).filter((m) => String(m.status).toUpperCase() === "APPROVED"));
      if (data?.value) setCfg({ gatilho: "lead_novo", ...(data.value as Config) });
      setDisparos((hist as Disparo[] | null) ?? []);
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
  const variaveis = useMemo(() => escolhido?.variaveis ?? [], [escolhido]);
  const faltaVariavel = variaveis.some((v) => !cfg.template?.params?.[v]);
  const gatilho: Gatilho = cfg.gatilho === "externo" ? "externo" : "lead_novo";

  /**
   * O corpo do modelo com os {{buracos}} já preenchidos pelo exemplo do apelido
   * escolhido. Variável ainda não mapeada aparece marcada, porque é exatamente
   * ela que faz a Meta recusar o template inteiro — melhor ver o buraco aqui do
   * que descobrir no primeiro lead.
   */
  const previa = useMemo(() => {
    if (!escolhido?.corpo) return null;
    return escolhido.corpo.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_todo, chave: string) => {
      const escolha = cfg.template?.params?.[String(chave)];
      if (!escolha) return "⟨falta mapear⟩";
      const apelido = APELIDOS.find((a) => a.valor === escolha);
      return apelido ? apelido.exemplo : String(escolha);
    });
  }, [escolhido, cfg.template?.params]);

  const resumo = useMemo(() => {
    const corte = inicioDoDiaSP();
    const hoje = disparos.filter((d) => d.criado_em >= corte);
    const conta = (s: string) => hoje.filter((d) => d.status === s).length;
    return {
      enviados: conta("enviado"),
      falhas: conta("falhou"),
      bloqueados: conta("bloqueado"),
      pendentes: conta("pendente"),
      // As falhas recentes valem mais que a contagem: é delas que sai o
      // "por que aquele lead não recebeu" sem abrir log da Vercel.
      ultimasFalhas: disparos.filter((d) => d.status === "falhou").slice(0, 5),
    };
  }, [disparos]);

  const salvar = useCallback(async () => {
    setSalvando(true);
    try {
      const value: Config = {
        ativo: !!cfg.ativo,
        gatilho,
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
  }, [cfg, gatilho, escolhido, carregar]);

  if (carregando) return <p className="text-sm text-gray-500">Carregando…</p>;

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Mensagem automática de primeiro contato</h2>
        <p className="mt-1 text-[13px] text-gray-600">
          Todo lead novo recebe esta mensagem, <strong>uma vez só</strong>. A mesma pessoa nunca
          recebe duas vezes — nem quando o Bitrix repete o gatilho, nem quando ela entra de novo
          por uma lista.
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

      {/* ── PASSO 1: QUANDO DISPARA ─────────────────────────────────────────
          O passo que faltava. Antes esta decisão morava numa automação do
          Bitrix apontando pra um workflow do n8n: pra mudar quando a mensagem
          saía, era preciso mexer em duas ferramentas fora do QS. */}
      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-[13px] font-medium text-gray-800">Quando disparar</legend>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="gatilho"
            className="mt-1"
            checked={gatilho === "lead_novo"}
            disabled={!podeMexer}
            onChange={() => setCfg((c) => ({ ...c, gatilho: "lead_novo" }))}
          />
          <span>
            <span className="text-sm font-medium text-gray-900">Assim que o lead entra no QS</span>
            <span className="block text-[12px] text-gray-500">
              O QS dispara sozinho quando o card nasce — landing page, tráfego, Bitrix, qualquer
              origem. Não depende de ninguém arrastar o card nem do n8n estar de pé.
            </span>
          </span>
        </label>

        <label className="mt-3 flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="gatilho"
            className="mt-1"
            checked={gatilho === "externo"}
            disabled={!podeMexer}
            onChange={() => setCfg((c) => ({ ...c, gatilho: "externo" }))}
          />
          <span>
            <span className="text-sm font-medium text-gray-900">Só quando o Bitrix mandar</span>
            <span className="block text-[12px] text-gray-500">
              Como era antes: a etapa &quot;primeiro contato&quot; no Bitrix chama o n8n, que chama
              o QS. É o plano B — use se o disparo automático precisar ser desligado sem desligar a
              mensagem inteira.
            </span>
          </span>
        </label>

        {gatilho === "lead_novo" && (
          <p className="mt-3 rounded-md bg-gray-50 p-2 text-[12px] text-gray-600">
            <strong>Quem não recebe, mesmo com isto ligado:</strong> lead que já existia no QS (pode
            estar no meio de uma negociação) e lead que entrou por carga de lista/resgate (é gente
            que já foi trabalhada). Nesses casos o disparo continua sendo manual.
          </p>
        )}
      </fieldset>

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

      {/* Prévia — o texto como o lead vai ler, não como o modelo é escrito */}
      {previa && (
        <div>
          <p className="text-[13px] font-medium text-gray-800">Como o lead vai ver</p>
          <div className="mt-1 rounded-lg bg-[#e6ddd4] p-3">
            {precisaMidia && (
              <div className="mb-2 flex items-center gap-2 rounded-md bg-white/70 px-2 py-3 text-[12px] text-gray-600">
                <span>▶</span>
                <span>{String(escolhido?.cabecalhoMidia).toLowerCase()} do cabeçalho</span>
              </div>
            )}
            <p className="whitespace-pre-wrap rounded-lg bg-white p-2 text-[13px] leading-relaxed text-gray-800 shadow-sm">
              {previa}
            </p>
            {escolhido?.rodape && (
              <p className="mt-1 px-2 text-[11px] text-gray-500">{escolhido.rodape}</p>
            )}
          </div>
          <p className="mt-1 text-[12px] text-gray-500">
            Os nomes são exemplo — no envio entram os dados do lead.
          </p>
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
          Bater o teto NÃO perde o lead: o disparo fica registrado como bloqueado e você vê aqui embaixo.
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

      {/* ── COMO ESTÁ INDO ──────────────────────────────────────────────────
          Sem isto, "está funcionando?" continua sendo pergunta pro time de
          tec — que era metade do problema que esta tela veio resolver. */}
      <div className="border-t border-gray-200 pt-4">
        <p className="text-[13px] font-medium text-gray-800">Como está indo (hoje)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Placar rotulo="Enviados" valor={resumo.enviados} />
          <Placar rotulo="Falharam" valor={resumo.falhas} alerta={resumo.falhas > 0} />
          <Placar rotulo="Bloqueados pelo teto" valor={resumo.bloqueados} alerta={resumo.bloqueados > 0} />
          {resumo.pendentes > 0 && <Placar rotulo="Em andamento" valor={resumo.pendentes} />}
        </div>

        {resumo.ultimasFalhas.length > 0 && (
          <div className="mt-3">
            <p className="text-[12px] font-medium text-gray-700">Últimas falhas</p>
            <ul className="mt-1 space-y-1">
              {resumo.ultimasFalhas.map((d) => (
                <li key={d.lead_id} className="rounded-md bg-red-50 px-2 py-1 text-[12px] text-red-800">
                  <span className="text-red-500">
                    {new Date(d.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </span>{" "}
                  — {d.motivo || "sem motivo registrado"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {disparos.length === 0 && (
          <p className="mt-2 text-[12px] text-gray-500">
            Nenhum disparo registrado ainda.
          </p>
        )}
      </div>
    </div>
  );
}

function Placar({ rotulo, valor, alerta = false }: { rotulo: string; valor: number; alerta?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${alerta ? "border-red-200 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
      <p className={`text-lg font-semibold ${alerta ? "text-red-700" : "text-gray-900"}`}>{valor}</p>
      <p className="text-[11px] text-gray-600">{rotulo}</p>
    </div>
  );
}

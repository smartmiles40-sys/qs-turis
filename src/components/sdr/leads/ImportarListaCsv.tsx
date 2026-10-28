import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { fetchAllRows } from "@/lib/qs/queries";
import { normalizePhoneBR } from "@/lib/whatsapp";
import { planCadenceDates, loadWorkHours, scheduleWeekdays, nextWorkMoment, clampToWorkWindow, DEFAULT_WORK_HOURS, type WorkHours } from "@/lib/workHours";
import { criarAlocadorEntrada, tetoDaCadencia, chaveDia, type AlocadorEntrada } from "@/lib/qs/cadenceTeto";
import type { Cadence, LeadSource, LeadStatus, SdrUser } from "../types";

// Importar LISTA de leads por planilha (CSV) pros SDRs (Bruno, 27/10/2026).
//
// O que mudou em relação ao modal antigo da tela de Leads:
//  • aceita a planilha "como ela vier": acha as colunas pelo nome (Nome, Nome
//    completo, Celular, WhatsApp, E-mail, Cidade, UF…) e deixa trocar à mão;
//  • lê o CSV do Excel brasileiro (separador ";" e acentos em Windows-1252);
//  • telefone sai no formato do discador/WhatsApp (55 + DDD + número);
//  • duplicado pela MESMA chave do banco (qs_tel_chave = últimos 8 dígitos);
//  • o gestor escolhe pra quais SDRs vai (divide igual) ou deixa o rodízio
//    automático do banco; o SDR que importa fica com a lista dele;
//  • prévia linha a linha do que entra, do que é repetido e do que não tem contato.
//
// A "lista" é a CADÊNCIA (mesma ideia do webhook ?lista=): escolher a cadência
// cria as atividades e é por ela que a lista aparece nos filtros.

type Campo = "nome" | "sobrenome" | "telefone" | "email" | "cidade" | "estado" | "empresa" | "segmento";

const CAMPOS: { chave: Campo; rotulo: string; dica?: string }[] = [
  { chave: "nome", rotulo: "Nome", dica: "obrigatório" },
  { chave: "sobrenome", rotulo: "Sobrenome", dica: "se vier separado" },
  { chave: "telefone", rotulo: "Telefone / WhatsApp" },
  { chave: "email", rotulo: "E-mail" },
  { chave: "cidade", rotulo: "Cidade" },
  { chave: "estado", rotulo: "Estado (UF)" },
  { chave: "empresa", rotulo: "Empresa" },
  { chave: "segmento", rotulo: "Interesse / destino" },
];

// Nomes de coluna que cada campo reconhece (sem acento, minúsculo, só letras e números).
const SINONIMOS: Record<Campo, string[]> = {
  nome: ["nome", "nomecompleto", "name", "fullname", "cliente", "nomedocliente", "contato", "lead", "primeironome", "firstname"],
  sobrenome: ["sobrenome", "lastname", "ultimonome"],
  telefone: ["telefone", "celular", "whatsapp", "whats", "zap", "fone", "phone", "tel", "telefone1", "celular1", "numero", "mobile", "telefonecelular", "telefonewhatsapp"],
  email: ["email", "emailaddress", "correio", "mail"],
  cidade: ["cidade", "city", "municipio"],
  estado: ["estado", "uf", "state"],
  empresa: ["empresa", "company", "companyname"],
  segmento: ["segmento", "segment", "interesse", "destino", "produto"],
};

const MAX_LINHAS = 5000;

function chaveColuna(h: string): string {
  return h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Mesma chave do banco (qs_tel_chave): os últimos 8 dígitos. */
function telChave(tel: string): string {
  const d = tel.replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : "";
}

/** Lê o arquivo: UTF-8 se for válido; senão Windows-1252 (CSV salvo pelo Excel em pt-BR). */
async function lerTexto(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let texto: string;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    texto = new TextDecoder("windows-1252").decode(buf);
  }
  return texto.replace(/^﻿/, "");
}

/** CSV de verdade: aspas, "" escapada e quebra de linha dentro de aspas. */
function parseCsv(texto: string): string[][] {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  const conta = (c: string) => primeira.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => conta(b) - conta(a))[0];
  const linhas: string[][] = [];
  let linha: string[] = [];
  let cur = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { cur += '"'; i++; }
        else aspas = false;
      } else cur += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(cur.trim()); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      linha.push(cur.trim()); cur = "";
      if (linha.some((c) => c)) linhas.push(linha);
      linha = [];
    } else cur += ch;
  }
  linha.push(cur.trim());
  if (linha.some((c) => c)) linhas.push(linha);
  return linhas;
}

function mapearAuto(cabecalho: string[]): Record<Campo, number> {
  const chaves = cabecalho.map(chaveColuna);
  const usado = new Set<number>();
  const out = {} as Record<Campo, number>;
  for (const { chave } of CAMPOS) {
    // 1º nome exato; depois "começa com" (ex.: "telefone principal", "e-mail pessoal").
    let idx = chaves.findIndex((c, i) => !usado.has(i) && SINONIMOS[chave].includes(c));
    if (idx < 0) idx = chaves.findIndex((c, i) => !usado.has(i) && SINONIMOS[chave].some((s) => s.length >= 4 && c.startsWith(s)));
    out[chave] = idx;
    if (idx >= 0) usado.add(idx);
  }
  return out;
}

type Situacao = "entra" | "repetido_arquivo" | "ja_existe" | "sem_contato" | "sem_nome";

interface Linha {
  n: number; // linha na planilha (cabeçalho = 1)
  nome: string;
  telefone: string; // já normalizado
  telefoneOriginal: string;
  email: string;
  cidade: string;
  estado: string;
  empresa: string;
  segmento: string;
  situacao: Situacao;
}

const SITUACAO_ROTULO: Record<Situacao, { texto: string; cor: string }> = {
  entra: { texto: "Entra", cor: "text-green-700 bg-green-50" },
  repetido_arquivo: { texto: "Repetido na planilha", cor: "text-amber-700 bg-amber-50" },
  ja_existe: { texto: "Já está no QS", cor: "text-gray-600 bg-gray-100" },
  sem_contato: { texto: "Sem telefone nem e-mail", cor: "text-red-700 bg-red-50" },
  sem_nome: { texto: "Sem nome", cor: "text-red-700 bg-red-50" },
};

interface Props {
  currentUser: SdrUser;
  isManager: boolean;
  users: SdrUser[];
  cadences: Cadence[];
  onClose: () => void;
  onImported: () => void | Promise<void>;
}

export default function ImportarListaCsv({ currentUser, isManager, users, cadences, onClose, onImported }: Props) {
  const [arquivo, setArquivo] = useState<string>("");
  const [cabecalho, setCabecalho] = useState<string[]>([]);
  const [dados, setDados] = useState<string[][]>([]);
  const [mapa, setMapa] = useState<Record<Campo, number> | null>(null);
  const [existentes, setExistentes] = useState<{ emails: Set<string>; tels: Set<string> } | null>(null);
  const [checando, setChecando] = useState(false);
  const [cadenceId, setCadenceId] = useState("");
  const [modo, setModo] = useState<"auto" | "escolher">("auto");
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState<{ ok: number; falhas: number; semAtividade: number; porSdr: Map<string, number> } | null>(null);
  const [verSo, setVerSo] = useState<"todas" | "entra" | "fora">("todas");

  const sdrs = useMemo(() => users.filter((u) => u.role === "sdr" && u.is_active).sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const cadenciasDisponiveis = useMemo(() => cadences.filter((c) => c.status === "disponivel"), [cadences]);

  async function carregarArquivo(file: File) {
    setResultado(null);
    let texto: string;
    try {
      texto = await lerTexto(file);
    } catch {
      notifyError("Não consegui ler o arquivo.");
      return;
    }
    const linhas = parseCsv(texto);
    if (linhas.length < 2) {
      notifyError("A planilha precisa ter a linha de títulos e pelo menos um contato.");
      return;
    }
    if (linhas.length - 1 > MAX_LINHAS) {
      notifyError(`A planilha tem ${linhas.length - 1} linhas. Divida em arquivos de até ${MAX_LINHAS}.`);
      return;
    }
    setArquivo(file.name);
    setCabecalho(linhas[0]);
    setDados(linhas.slice(1));
    setMapa(mapearAuto(linhas[0]));

    // Base atual pra marcar o que já existe (paginado: a base passa de 1.000).
    setChecando(true);
    try {
      const rows = await fetchAllRows<{ email: string | null; phone: string | null }>((from, to) =>
        supabase.from("qs_leads").select("email, phone").order("id").range(from, to)
      );
      setExistentes({
        emails: new Set(rows.map((r) => (r.email ?? "").trim().toLowerCase()).filter(Boolean)),
        tels: new Set(rows.map((r) => telChave(r.phone ?? "")).filter(Boolean)),
      });
    } catch (e) {
      console.warn("[lista CSV] checagem de duplicados falhou:", e);
      setExistentes(null);
      notifyError("Não consegui conferir os leads que já existem. Tente abrir o arquivo de novo.");
    } finally {
      setChecando(false);
    }
  }

  const linhas: Linha[] = useMemo(() => {
    if (!mapa) return [];
    const pega = (cols: string[], c: Campo) => (mapa[c] >= 0 ? (cols[mapa[c]] ?? "").trim() : "");
    const vistos = new Set<string>();
    return dados.map((cols, i) => {
      const nome = [pega(cols, "nome"), pega(cols, "sobrenome")].filter(Boolean).join(" ").replace(/\s+/g, " ");
      const telefoneOriginal = pega(cols, "telefone");
      const telefone = telefoneOriginal ? normalizePhoneBR(telefoneOriginal) || telefoneOriginal : "";
      const email = pega(cols, "email").toLowerCase();
      const l: Linha = {
        n: i + 2,
        nome,
        telefone,
        telefoneOriginal,
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
        cidade: pega(cols, "cidade"),
        estado: pega(cols, "estado").toUpperCase().slice(0, 30),
        empresa: pega(cols, "empresa"),
        segmento: pega(cols, "segmento"),
        situacao: "entra",
      };
      const tk = telChave(l.telefone);
      if (!l.nome) l.situacao = "sem_nome";
      else if (!tk && !l.email) l.situacao = "sem_contato";
      else if ((tk && vistos.has("t" + tk)) || (l.email && vistos.has("e" + l.email))) l.situacao = "repetido_arquivo";
      else if (existentes && ((tk && existentes.tels.has(tk)) || (l.email && existentes.emails.has(l.email)))) l.situacao = "ja_existe";
      if (l.situacao === "entra" || l.situacao === "ja_existe") {
        if (tk) vistos.add("t" + tk);
        if (l.email) vistos.add("e" + l.email);
      }
      return l;
    });
  }, [dados, mapa, existentes]);

  const contagem = useMemo(() => {
    const c: Record<Situacao, number> = { entra: 0, repetido_arquivo: 0, ja_existe: 0, sem_contato: 0, sem_nome: 0 };
    for (const l of linhas) c[l.situacao]++;
    return c;
  }, [linhas]);

  const entram = useMemo(() => linhas.filter((l) => l.situacao === "entra"), [linhas]);

  // Quem fica com cada lead: gestor escolhendo → divide igual na ordem; SDR → ele mesmo; auto → banco decide.
  const donos: (string | null)[] = useMemo(() => {
    if (!isManager) return entram.map(() => currentUser.id);
    if (modo === "escolher") {
      const lista = sdrs.filter((s) => escolhidos.has(s.id)).map((s) => s.id);
      if (lista.length === 0) return entram.map(() => null);
      return entram.map((_, i) => lista[i % lista.length]);
    }
    return entram.map(() => null);
  }, [entram, isManager, modo, sdrs, escolhidos, currentUser.id]);

  const previaDivisao = useMemo(() => {
    if (!isManager || modo !== "escolher") return [];
    const m = new Map<string, number>();
    for (const d of donos) if (d) m.set(d, (m.get(d) ?? 0) + 1);
    return sdrs.filter((s) => m.has(s.id)).map((s) => ({ nome: s.name, n: m.get(s.id) ?? 0 }));
  }, [donos, isManager, modo, sdrs]);

  const faltaEscolher = isManager && modo === "escolher" && escolhidos.size === 0;
  const podeImportar = !!mapa && mapa.nome >= 0 && (mapa.telefone >= 0 || mapa.email >= 0) && entram.length > 0 && !!existentes && !checando && !faltaEscolher;

  function baixarModelo() {
    const csv = "﻿nome;telefone;email;cidade;estado;interesse\r\nMaria Silva;(11) 98888-7777;maria@email.com;São Paulo;SP;Japão\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-lista-qs.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importar() {
    if (!podeImportar) return;
    setImportando(true);
    setProgresso(0);
    try {
      // Dias/atividades da cadência — 1 busca pro lote inteiro.
      // CÓPIA-ESPELHO de createCadenceTasks (src/lib/qs/queries.ts): datas via
      // planCadenceDates, ordem por order_index, prioridade pelo período
      // (manhã=alta, >=12:30=média, sem horário=baixa), status "pendente",
      // is_extra false, owner_id = dono FINAL do lead e tag dia:N.
      let cadDays: { day_number: number; activities: { channel_type: string; scheduled_time: string | null; order_index: number }[] }[] = [];
      let dataDoDia = new Map<number, Date>();
      let horario: WorkHours = DEFAULT_WORK_HOURS;
      let primeiroDia = 1;
      // Teto de entrada (0216): no máximo N leads novos por dia por SDR — o
      // excedente começa nos próximos dias de execução (ver cadenceTeto.ts).
      let alocador: AlocadorEntrada | null = null;
      let diasPermitidos: number[] = [1, 2, 3, 4, 5];
      let politica: string | null = null;
      if (cadenceId) {
        const [{ data }, { data: cadRow }, wh] = await Promise.all([
          supabase
            .from("qs_cadence_days")
            .select("day_number, activities:qs_cadence_activities(channel_type, scheduled_time, order_index)")
            .eq("cadence_id", cadenceId)
            .order("day_number"),
          // "*": teto_entrada_dia pode não existir sem a 0216.
          supabase.from("qs_cadences").select("*").eq("id", cadenceId).maybeSingle(),
          loadWorkHours(),
        ]);
        cadDays = (data ?? []) as typeof cadDays;
        horario = wh;
        const plan = cadRow as { execution_weekdays: number[] | null; offday_policy: string | null } | null;
        dataDoDia = planCadenceDates(
          cadDays.map((d) => d.day_number ?? 1),
          scheduleWeekdays(wh, plan?.execution_weekdays ?? null),
          plan?.offday_policy ?? null
        );
        primeiroDia = cadDays.length ? Math.min(...cadDays.map((d) => d.day_number ?? 1)) : 1;
        diasPermitidos = scheduleWeekdays(wh, plan?.execution_weekdays ?? null);
        politica = plan?.offday_policy ?? null;
        const teto = tetoDaCadencia(cadRow);
        if (teto) alocador = criarAlocadorEntrada({ cadenceId, teto, primeiroDia, allowedWeekdays: diasPermitidos });
      }

      let ok = 0, falhas = 0, semAtividade = 0;
      const porSdr = new Map<string, number>();
      const agora = new Date().toISOString();

      const gravarUm = async (l: Linha, dono: string | null) => {
        const partes = l.nome.split(" ");
        const { data: inserted, error } = await supabase
          .from("qs_leads")
          .insert({
            first_name: partes[0] || "",
            last_name: partes.slice(1).join(" ") || null,
            full_name: l.nome,
            email: l.email || null,
            phone: l.telefone || null,
            city: l.cidade || null,
            state: l.estado || null,
            company_name: l.empresa || null,
            segment: l.segmento || null,
            source: "importacao" as LeadSource,
            status: cadenceId ? ("em_prospeccao" as LeadStatus) : ("nao_iniciado" as LeadStatus),
            cadence_id: cadenceId || null,
            cadence_started_at: cadenceId ? agora : null,
            arrived_at: agora,
            // null = o gatilho do banco escolhe (rodízio equilibrado dos SDRs da cadência).
            ...(dono ? { owner_id: dono } : {}),
          })
          .select("id, owner_id")
          .single();
        if (error || !inserted) {
          falhas++;
          console.warn("[lista CSV] linha", l.n, error?.message);
          return;
        }
        ok++;
        porSdr.set(inserted.owner_id, (porSdr.get(inserted.owner_id) ?? 0) + 1);

        if (cadenceId && cadDays.length > 0) {
          // Datas DESTE lead: iguais às do lote, a não ser que o teto o empurre.
          let datasDoLead = dataDoDia;
          const previsto = dataDoDia.get(primeiroDia);
          if (alocador && previsto) {
            const inicio = await alocador.alocar(inserted.owner_id, previsto);
            if (chaveDia(inicio) !== chaveDia(previsto)) {
              const base = new Date(inicio); base.setHours(0, 0, 0, 0);
              datasDoLead = planCadenceDates(cadDays.map((d) => d.day_number ?? 1), diasPermitidos, politica, nextWorkMoment(horario, base));
            }
          }
          const tarefas = cadDays.flatMap((d) =>
            [...d.activities].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)).map((a) => {
              const planned = new Date(datasDoLead.get(d.day_number ?? 1) ?? new Date());
              const [h, m] = (a.scheduled_time || "09:00").split(":");
              planned.setHours(Number(h) || 9, Number(m) || 0, 0, 0);
              const when = (d.day_number ?? 1) === primeiroDia
                ? nextWorkMoment(horario, new Date(Math.max(planned.getTime(), Date.now())))
                : clampToWorkWindow(horario, planned);
              return {
                lead_id: inserted.id,
                cadence_id: cadenceId,
                owner_id: inserted.owner_id,
                channel_type: a.channel_type,
                priority: !a.scheduled_time ? "baixa" : a.scheduled_time >= "12:30" ? "media" : "alta",
                scheduled_at: when.toISOString(),
                status: "pendente",
                is_extra: false,
                tags: [`dia:${d.day_number ?? 1}`],
              };
            })
          );
          if (tarefas.length > 0) {
            const { error: taskErr } = await supabase.from("qs_tasks").insert(tarefas);
            if (taskErr) { semAtividade++; console.warn("[lista CSV] sem atividades p/ lead", inserted.id, taskErr.message); }
          }
        }
      };

      // Rodízio automático: um por vez (cada insert é uma transação e o gatilho
      // equilibra olhando o que já entrou). Dono escolhido: de 5 em 5.
      const lote = donos.some((d) => d) ? 5 : 1;
      for (let i = 0; i < entram.length; i += lote) {
        await Promise.all(entram.slice(i, i + lote).map((l, j) => gravarUm(l, donos[i + j])));
        setProgresso(Math.min(i + lote, entram.length));
      }

      if (falhas > 0) notifyError(`${falhas} lead(s) não entraram. Confira essas linhas da planilha.`);
      if (semAtividade > 0) notifyError(`${semAtividade} lead(s) entraram SEM atividades. Vincule a cadência deles de novo.`);
      if (ok > 0) {
        const esp = alocador?.espalhados() ?? 0;
        notifySuccess(`${ok} lead(s) importados.` + (esp > 0 ? ` ${esp} começam nos próximos dias (teto de leads novos por dia da cadência).` : ""));
      }
      setResultado({ ok, falhas, semAtividade, porSdr });
      await onImported();
    } catch (e) {
      console.warn("[lista CSV] importação falhou:", e);
      notifyError("A importação parou no meio. O que já entrou ficou salvo. Abra a planilha de novo: o que já entrou aparece como \"Já está no QS\".");
    } finally {
      setImportando(false);
    }
  }

  function fechar() {
    if (importando) return;
    onClose();
  }

  const nomeDe = (id: string) => users.find((u) => u.id === id)?.name ?? "—";
  const visiveis = linhas.filter((l) => verSo === "todas" || (verSo === "entra" ? l.situacao === "entra" : l.situacao !== "entra"));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={fechar} />
      <div className="relative bg-white rounded-xl border border-gray-100 w-full max-w-3xl mx-4 p-4 md:p-6 max-h-[88vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-5 gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Importar lista de leads</h2>
            <p className="text-xs text-gray-500 mt-0.5">Planilha em CSV (no Excel: Arquivo → Salvar como → CSV).</p>
          </div>
          <button
            onClick={fechar}
            disabled={importando}
            title={importando ? "Aguarde a importação terminar" : "Fechar"}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {resultado ? (
          <div className="text-center py-6">
            <p className="text-lg font-semibold text-gray-900 mb-1">{resultado.ok} lead{resultado.ok !== 1 ? "s" : ""} importado{resultado.ok !== 1 ? "s" : ""}</p>
            {(resultado.falhas > 0 || resultado.semAtividade > 0) && (
              <p className="text-sm text-red-600 mb-2">
                {resultado.falhas > 0 && <>{resultado.falhas} não entraram. </>}
                {resultado.semAtividade > 0 && <>{resultado.semAtividade} entraram sem atividades.</>}
              </p>
            )}
            {resultado.porSdr.size > 0 && (
              <div className="inline-block text-left text-sm text-gray-700 bg-gray-50 rounded-lg px-4 py-3 mb-4">
                {[...resultado.porSdr.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
                  <div key={id} className="flex justify-between gap-6"><span>{nomeDe(id)}</span><span className="tabular-nums font-medium">{n}</span></div>
                ))}
              </div>
            )}
            <div>
              <button onClick={onClose} className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] transition-colors">
                Fechar
              </button>
            </div>
          </div>
        ) : !mapa ? (
          <div>
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-10 cursor-pointer hover:border-[#0147FF]/50 hover:bg-[#0147FF]/5 transition-colors">
              <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Escolher a planilha (.csv)</span>
              <span className="text-xs text-gray-500">Precisa de uma coluna de nome e uma de telefone ou e-mail. O resto é opcional.</span>
              <input
                type="file"
                accept=".csv,.txt,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void carregarArquivo(f);
                  e.target.value = "";
                }}
              />
            </label>
            <button onClick={baixarModelo} className="mt-3 text-xs font-medium text-[#0147FF] hover:underline">
              Baixar planilha modelo
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* 1. Colunas */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900">1. Colunas da planilha <span className="font-normal text-gray-500">({arquivo})</span></h3>
                <button
                  onClick={() => { setMapa(null); setDados([]); setCabecalho([]); setExistentes(null); }}
                  disabled={importando}
                  className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
                >
                  Trocar arquivo
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">Já achei as colunas pelo nome. Se alguma estiver errada, troque aqui.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CAMPOS.map(({ chave, rotulo, dica }) => (
                  <label key={chave} className="flex items-center gap-2 text-xs">
                    <span className="w-36 shrink-0 text-gray-700">
                      {rotulo}
                      {dica && <span className="text-gray-400"> · {dica}</span>}
                    </span>
                    <select
                      value={mapa[chave]}
                      disabled={importando}
                      onChange={(e) => setMapa({ ...mapa, [chave]: Number(e.target.value) })}
                      className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-xs bg-white focus:outline-none focus:border-[#0147FF] ${
                        chave === "nome" && mapa.nome < 0 ? "border-red-300" : "border-gray-200"
                      }`}
                    >
                      <option value={-1}>— não usar —</option>
                      {cabecalho.map((h, i) => (
                        <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {mapa.nome < 0 && <p className="text-xs text-red-600 mt-2">Escolha a coluna do nome.</p>}
              {mapa.telefone < 0 && mapa.email < 0 && <p className="text-xs text-red-600 mt-2">Escolha a coluna do telefone ou do e-mail.</p>}
            </section>

            {/* 2. Prévia */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">2. O que vai entrar</h3>
              {checando ? (
                <p className="text-xs text-gray-500">Conferindo quem já está no QS…</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 mb-2 text-xs">
                    <span className="px-2 py-1 rounded-md bg-green-50 text-green-700 font-medium">{contagem.entra} entram</span>
                    {contagem.ja_existe > 0 && <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-600">{contagem.ja_existe} já estão no QS</span>}
                    {contagem.repetido_arquivo > 0 && <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-700">{contagem.repetido_arquivo} repetidos na planilha</span>}
                    {contagem.sem_contato > 0 && <span className="px-2 py-1 rounded-md bg-red-50 text-red-700">{contagem.sem_contato} sem telefone nem e-mail</span>}
                    {contagem.sem_nome > 0 && <span className="px-2 py-1 rounded-md bg-red-50 text-red-700">{contagem.sem_nome} sem nome</span>}
                    <span className="ml-auto flex gap-1">
                      {(["todas", "entra", "fora"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => setVerSo(v)}
                          className={`px-2 py-1 rounded-md ${verSo === v ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                        >
                          {v === "todas" ? "Todas" : v === "entra" ? "Entram" : "Ficam de fora"}
                        </button>
                      ))}
                    </span>
                  </div>
                  <div className="overflow-x-auto max-h-60 overflow-y-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="text-left text-gray-500">
                          <th className="px-2 py-2 font-semibold">Linha</th>
                          <th className="px-2 py-2 font-semibold">Nome</th>
                          <th className="px-2 py-2 font-semibold">Telefone</th>
                          <th className="px-2 py-2 font-semibold">E-mail</th>
                          <th className="px-2 py-2 font-semibold">Cidade</th>
                          <th className="px-2 py-2 font-semibold">Situação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiveis.slice(0, 300).map((l) => (
                          <tr key={l.n} className="border-t border-gray-50">
                            <td className="px-2 py-1.5 text-gray-400 tabular-nums">{l.n}</td>
                            <td className="px-2 py-1.5 text-gray-900">{l.nome || "—"}</td>
                            <td className="px-2 py-1.5 text-gray-700 tabular-nums" title={l.telefoneOriginal !== l.telefone ? `Na planilha: ${l.telefoneOriginal}` : undefined}>
                              {l.telefone || "—"}
                            </td>
                            <td className="px-2 py-1.5 text-gray-700">{l.email || "—"}</td>
                            <td className="px-2 py-1.5 text-gray-700">{[l.cidade, l.estado].filter(Boolean).join(" / ") || "—"}</td>
                            <td className="px-2 py-1.5">
                              <span className={`px-1.5 py-0.5 rounded ${SITUACAO_ROTULO[l.situacao].cor}`}>{SITUACAO_ROTULO[l.situacao].texto}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {visiveis.length > 300 && <p className="text-xs text-gray-400 px-2 py-2">Mostrando 300 de {visiveis.length} linhas.</p>}
                  </div>
                </>
              )}
            </section>

            {/* 3. Pra quem vai */}
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">3. Pra quem vai</h3>
              <label className="block text-xs font-medium text-gray-700 mb-0.5">Em qual lista esses leads entram?</label>
              <p className="text-[11px] text-gray-400 mb-1">A lista já cria as atividades do SDR, dia a dia.</p>
              <select
                value={cadenceId}
                disabled={importando}
                onChange={(e) => setCadenceId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:border-[#0147FF] mb-3"
              >
                <option value="">Nenhuma lista (entram sem atividades)</option>
                {cadenciasDisponiveis.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              {isManager ? (
                <>
                  <div className="flex gap-1 p-1 rounded-lg bg-gray-100 mb-2">
                    <button
                      onClick={() => setModo("auto")}
                      disabled={importando}
                      className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${modo === "auto" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      Rodízio automático
                    </button>
                    <button
                      onClick={() => setModo("escolher")}
                      disabled={importando}
                      className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${modo === "escolher" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                    >
                      Escolher os SDRs
                    </button>
                  </div>
                  {modo === "auto" ? (
                    <p className="text-xs text-gray-500">
                      O QS divide entre os SDRs {cadenceId ? "dessa lista" : "ativos"}, equilibrando com quem recebeu menos e pulando quem está afastado.
                    </p>
                  ) : (
                    <div>
                      <div className="flex flex-wrap gap-2">
                        {sdrs.map((s) => {
                          const on = escolhidos.has(s.id);
                          return (
                            <button
                              key={s.id}
                              disabled={importando}
                              onClick={() => {
                                const n = new Set(escolhidos);
                                if (on) n.delete(s.id); else n.add(s.id);
                                setEscolhidos(n);
                              }}
                              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                                on ? "bg-[#0147FF] border-[#0147FF] text-white" : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                              }`}
                            >
                              {s.name}
                            </button>
                          );
                        })}
                        {sdrs.length === 0 && <span className="text-xs text-gray-500">Nenhum SDR ativo.</span>}
                      </div>
                      {previaDivisao.length > 0 ? (
                        <p className="text-xs text-gray-600 mt-2">
                          Divide igual: {previaDivisao.map((p) => `${p.nome} ${p.n}`).join(" · ")}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-700 mt-2">Marque pelo menos um SDR.</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-500">Os leads desta lista ficam com você.</p>
              )}
            </section>

            {importando && (
              <div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-[#0147FF] transition-all" style={{ width: `${Math.round((progresso / Math.max(entram.length, 1)) * 100)}%` }} />
                </div>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">Importando {progresso}/{entram.length}… Não feche esta janela.</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                onClick={fechar}
                disabled={importando}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => void importar()}
                disabled={!podeImportar || importando}
                className="px-4 py-2 rounded-lg bg-[#0147FF] text-sm font-medium text-white hover:bg-[#0139D6] disabled:opacity-50 transition-colors"
              >
                {importando ? "Importando..." : `Importar ${entram.length} lead${entram.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

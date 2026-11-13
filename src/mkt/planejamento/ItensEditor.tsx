// src/mkt/planejamento/ItensEditor.tsx
// -----------------------------------------------------------------------------
// A LISTA DE CONTEÚDOS de um planejamento (0395), no formato padrão que o Bruno
// pediu (13/11): título, formato, referência, como adaptar pra nossa marca, onde
// vai ser postado (perfil), data e horário — e as obs dos supervisores em cada um.
//
// Sem Supabase e sem useMkt aqui: o MESMO editor serve o time (dentro do QS) e o
// portal da agência (fora do login do QS). Quem usa passa os dados e os botões.
// -----------------------------------------------------------------------------
import { useId, type ReactNode } from "react";
import { FORMATOS, NOME_FALTA, NOME_FORMATO, faltasDoItem, type Falta, type Formato, type ItemPlano, type Periodo } from "./regras";

export interface PerfilOpcao { id: string; nome: string; rede: string }
export interface ObsVista { id: string; autor: string; texto: string; rotulo?: string; resolvida: boolean; criado_em: string; daAgencia?: boolean }

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function dataCurta(d: string | null | undefined): string {
  if (!d) return "—";
  const [a, m, dia] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, dia, 12));
  return `${DIAS[dt.getUTCDay()]}, ${String(dia).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
export function quando(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function ItensEditor({
  itens, onChange, perfis, periodo, mostrarFaltas, obsDoItem, acoesDoItem, avisosDoItem, vazio,
}: {
  itens: ItemPlano[];
  /** Sem onChange = só leitura. */
  onChange?: (itens: ItemPlano[]) => void;
  perfis: PerfilOpcao[];
  periodo: Periodo;
  /** Pinta de vermelho o que falta (depois da primeira tentativa de enviar, ou sempre na leitura). */
  mostrarFaltas?: boolean;
  obsDoItem?: (item: ItemPlano) => ObsVista[];
  acoesDoItem?: (item: ItemPlano, n: number) => ReactNode;
  avisosDoItem?: (n: number) => string[];
  vazio?: ReactNode;
}) {
  const editavel = !!onChange;
  const ativos = perfis.map((p) => p.id);

  function mudar(n: number, patch: Partial<ItemPlano>) {
    onChange?.(itens.map((i, k) => (k === n ? { ...i, ...patch } : i)));
  }
  function mover(n: number, d: -1 | 1) {
    const alvo = n + d;
    if (alvo < 0 || alvo >= itens.length) return;
    const nova = [...itens];
    [nova[n], nova[alvo]] = [nova[alvo], nova[n]];
    onChange?.(nova);
  }
  function remover(n: number) {
    onChange?.(itens.filter((_, k) => k !== n));
  }
  function adicionar() {
    onChange?.([...itens, { titulo: "", formato: null, referencias: [], adaptacao: "", perfil_ids: [], data_postagem: null, horario: null }]);
  }

  return (
    <div className="space-y-3">
      {itens.length === 0 && (vazio ?? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum conteúdo ainda.</p>)}
      {itens.map((item, n) => (
        <CartaoItem key={item.id ?? `novo-${n}`} n={n} item={item} total={itens.length} editavel={editavel}
          perfis={perfis} periodo={periodo}
          faltas={mostrarFaltas ? faltasDoItem(item, periodo, ativos) : []}
          obs={obsDoItem?.(item) ?? []} acoes={acoesDoItem?.(item, n)} avisos={avisosDoItem?.(n) ?? []}
          onMudar={(p) => mudar(n, p)} onMover={(d) => mover(n, d)} onRemover={() => remover(n)} />
      ))}
      {editavel && (
        <button type="button" onClick={adicionar}
          className="w-full rounded-xl py-3 text-[14px] font-semibold border-2 border-dashed transition-colors"
          style={{ borderColor: "var(--line)", color: "var(--rel-ink)" }}>
          + Adicionar conteúdo
        </button>
      )}
    </div>
  );
}

function CartaoItem({ n, item, total, editavel, perfis, periodo, faltas, obs, acoes, avisos, onMudar, onMover, onRemover }: {
  n: number; item: ItemPlano; total: number; editavel: boolean; perfis: PerfilOpcao[]; periodo: Periodo;
  faltas: Falta[]; obs: ObsVista[]; acoes?: ReactNode; avisos: string[];
  onMudar: (p: Partial<ItemPlano>) => void; onMover: (d: -1 | 1) => void; onRemover: () => void;
}) {
  const uid = useId();
  const falta = (f: Falta) => faltas.includes(f);
  const abertas = obs.filter((o) => !o.resolvida);
  const borda = abertas.length ? "var(--warn-line)" : faltas.length ? "var(--err-line)" : "var(--line)";

  return (
    <article className="rel-card p-4 sm:p-5" style={{ borderColor: borda }} aria-labelledby={`${uid}-t`}>
      <header className="flex flex-wrap items-center gap-2 mb-3">
        <span id={`${uid}-t`} className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--rel-ink)" }}>
          Conteúdo {n + 1}
        </span>
        {!editavel && item.formato && <Pilula>{NOME_FORMATO[item.formato]}</Pilula>}
        {!editavel && item.data_postagem && <Pilula>{dataCurta(item.data_postagem)}{item.horario ? ` · ${item.horario.slice(0, 5)}` : ""}</Pilula>}
        {faltas.length > 0 && <Pilula tom="erro">falta {faltas.length === 1 ? NOME_FALTA[faltas[0]] : `${faltas.length} campos`}</Pilula>}
        {abertas.length > 0 && <Pilula tom="aviso">{abertas.length} obs</Pilula>}
        <span className="flex-1" />
        {editavel && (
          <div className="flex gap-1">
            <BotaoIcone rotulo="Subir" desligado={n === 0} onClick={() => onMover(-1)}>↑</BotaoIcone>
            <BotaoIcone rotulo="Descer" desligado={n === total - 1} onClick={() => onMover(1)}>↓</BotaoIcone>
            <BotaoIcone rotulo={`Remover conteúdo ${n + 1}`} onClick={onRemover}>✕</BotaoIcone>
          </div>
        )}
      </header>

      {editavel ? (
        <div className="grid gap-3 sm:grid-cols-6">
          <CampoItem id={`${uid}-tit`} rotulo="Título / gancho" erro={falta("titulo")} className="sm:col-span-4">
            <input id={`${uid}-tit`} className="rel-input" value={item.titulo ?? ""} maxLength={200} aria-invalid={falta("titulo")}
              onChange={(e) => onMudar({ titulo: e.target.value })} placeholder="Ex.: Festival das Lanternas na Tailândia" />
          </CampoItem>
          <CampoItem id={`${uid}-fmt`} rotulo="Formato" erro={falta("formato")} className="sm:col-span-2">
            <select id={`${uid}-fmt`} className="rel-input" value={item.formato ?? ""} aria-invalid={falta("formato")}
              onChange={(e) => onMudar({ formato: (e.target.value || null) as Formato | null })}>
              <option value="">Escolha…</option>
              {FORMATOS.map((f) => <option key={f} value={f}>{NOME_FORMATO[f]}</option>)}
            </select>
          </CampoItem>
          <CampoItem id={`${uid}-ada`} rotulo="Como vai ser adaptado para a nossa marca" erro={falta("adaptacao")} className="sm:col-span-6"
            dica="Resumo de como o conteúdo vai ser feito pra STFV (mín. 20 letras).">
            <textarea id={`${uid}-ada`} className="rel-input" rows={3} maxLength={4000} value={item.adaptacao ?? ""} aria-invalid={falta("adaptacao")}
              onChange={(e) => onMudar({ adaptacao: e.target.value })} />
          </CampoItem>
          <CampoItem id={`${uid}-ref`} rotulo="Referência (link)" erro={falta("referencia")} className="sm:col-span-6" dica="Um link por linha.">
            <textarea id={`${uid}-ref`} className="rel-input" rows={2} value={(item.referencias ?? []).join("\n")} aria-invalid={falta("referencia")}
              onChange={(e) => onMudar({ referencias: e.target.value.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 5) })}
              placeholder="https://www.instagram.com/reel/…" />
          </CampoItem>
          <fieldset className="sm:col-span-6">
            <legend className="text-[13px] font-semibold mb-1.5" style={{ color: falta("perfil") ? "var(--err-ink)" : "var(--ink2)" }}>
              Onde vai ser postado {falta("perfil") && <span className="font-normal">— escolha pelo menos um</span>}
            </legend>
            <div className="flex flex-wrap gap-2">
              {perfis.map((p) => {
                const marcado = (item.perfil_ids ?? []).includes(p.id);
                return (
                  <label key={p.id} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] cursor-pointer select-none"
                    style={{ border: `1px solid ${marcado ? "var(--rel)" : "var(--line)"}`, background: marcado ? "var(--rel-soft)" : "transparent", color: "var(--ink)" }}>
                    <input type="checkbox" checked={marcado} className="accent-[var(--rel)]"
                      onChange={() => onMudar({ perfil_ids: marcado ? (item.perfil_ids ?? []).filter((x) => x !== p.id) : [...(item.perfil_ids ?? []), p.id] })} />
                    {p.nome}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <CampoItem id={`${uid}-dat`} rotulo="Data de postagem" erro={falta("data") || falta("data_fora")} className="sm:col-span-3"
            dica={falta("data_fora") ? `Tem que ser entre ${dataCurta(periodo.periodo_inicio)} e ${dataCurta(periodo.periodo_fim)}.` : undefined}>
            <input id={`${uid}-dat`} type="date" className="rel-input" value={item.data_postagem ?? ""} min={periodo.periodo_inicio} max={periodo.periodo_fim}
              aria-invalid={falta("data") || falta("data_fora")} onChange={(e) => onMudar({ data_postagem: e.target.value || null })} />
          </CampoItem>
          <CampoItem id={`${uid}-hor`} rotulo="Horário" erro={falta("horario")} className="sm:col-span-3">
            <input id={`${uid}-hor`} type="time" className="rel-input" value={(item.horario ?? "").slice(0, 5)} aria-invalid={falta("horario")}
              onChange={(e) => onMudar({ horario: e.target.value || null })} />
          </CampoItem>
        </div>
      ) : (
        <Leitura item={item} perfis={perfis} faltas={faltas} />
      )}

      {avisos.length > 0 && (
        <ul className="mt-3 space-y-1">
          {avisos.map((a, k) => (
            <li key={k} className="text-[12.5px] flex gap-2" style={{ color: "var(--warn-ink)" }}>
              <span aria-hidden>✦</span><span><b>IA:</b> {a}</span>
            </li>
          ))}
        </ul>
      )}

      {obs.length > 0 && (
        <div className="mt-3 space-y-2">
          {obs.map((o) => (
            <div key={o.id} className="rounded-lg px-3 py-2 text-[13px]"
              style={{ background: o.daAgencia ? "var(--card2)" : o.resolvida ? "var(--card2)" : "var(--warn-bg)", opacity: o.resolvida ? 0.7 : 1 }}>
              <div className="text-[11.5px] mb-0.5" style={{ color: "var(--ink3)" }}>
                <b style={{ color: "var(--ink2)" }}>{o.autor}</b>{o.rotulo ? ` · ${o.rotulo}` : ""} · {quando(o.criado_em)}{o.resolvida ? " · resolvida" : ""}
              </div>
              <p className="whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{o.texto}</p>
            </div>
          ))}
        </div>
      )}

      {acoes && <div className="mt-3 flex flex-wrap gap-2">{acoes}</div>}
    </article>
  );
}

function Leitura({ item, perfis, faltas }: { item: ItemPlano; perfis: PerfilOpcao[]; faltas: Falta[] }) {
  const nomes = (item.perfil_ids ?? []).map((id) => perfis.find((p) => p.id === id)?.nome ?? "perfil removido");
  const Linha = ({ rotulo, falta, children }: { rotulo: string; falta?: boolean; children: ReactNode }) => (
    <div className="grid sm:grid-cols-[180px_1fr] gap-x-3 gap-y-0.5 py-1.5" style={{ borderTop: "1px solid var(--line)" }}>
      <dt className="text-[12px] font-semibold" style={{ color: falta ? "var(--err-ink)" : "var(--ink3)" }}>{rotulo}</dt>
      <dd className="text-[13.5px] min-w-0 break-words" style={{ color: falta ? "var(--err-ink)" : "var(--ink)" }}>{children}</dd>
    </div>
  );
  return (
    <dl>
      <Linha rotulo="Título" falta={faltas.includes("titulo")}><b>{item.titulo || "— falta"}</b></Linha>
      <Linha rotulo="Adaptação pra marca" falta={faltas.includes("adaptacao")}>
        <span className="whitespace-pre-wrap">{item.adaptacao || "— falta"}</span>
      </Linha>
      <Linha rotulo="Referência" falta={faltas.includes("referencia")}>
        {(item.referencias ?? []).length ? (
          <ul className="space-y-0.5">{item.referencias!.map((r) => (
            <li key={r}><a href={r} target="_blank" rel="noopener noreferrer" className="underline break-all" style={{ color: "var(--rel-ink)" }}>{r}</a></li>
          ))}</ul>
        ) : "— falta"}
      </Linha>
      <Linha rotulo="Onde vai ser postado" falta={faltas.includes("perfil")}>{nomes.length ? nomes.join(", ") : "— falta"}</Linha>
      <Linha rotulo="Data e horário" falta={faltas.includes("data") || faltas.includes("data_fora") || faltas.includes("horario")}>
        {item.data_postagem ? dataCurta(item.data_postagem) : "— falta data"} · {item.horario ? item.horario.slice(0, 5) : "— falta horário"}
      </Linha>
    </dl>
  );
}

function CampoItem({ id, rotulo, erro, dica, className = "", children }: { id: string; rotulo: string; erro?: boolean; dica?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] font-semibold mb-1" style={{ color: erro ? "var(--err-ink)" : "var(--ink2)" }}>
        {rotulo}{erro && <span className="font-normal"> — obrigatório</span>}
      </label>
      {children}
      {dica && <p className="text-[12px] mt-1" style={{ color: erro ? "var(--err-ink)" : "var(--ink3)" }}>{dica}</p>}
    </div>
  );
}

function Pilula({ children, tom }: { children: ReactNode; tom?: "erro" | "aviso" }) {
  const st = tom === "erro" ? { background: "var(--err-bg)", color: "var(--err-ink)" }
    : tom === "aviso" ? { background: "var(--warn-bg)", color: "var(--warn-ink)" }
    : { background: "var(--card2)", color: "var(--ink2)" };
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11.5px] font-semibold" style={st}>{children}</span>;
}

function BotaoIcone({ rotulo, desligado, onClick, children }: { rotulo: string; desligado?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={rotulo} title={rotulo} disabled={desligado} onClick={onClick}
      className="w-8 h-8 rounded-md text-[14px] disabled:opacity-30" style={{ border: "1px solid var(--line)", color: "var(--ink2)" }}>
      {children}
    </button>
  );
}

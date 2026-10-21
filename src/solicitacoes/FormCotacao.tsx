// src/solicitacoes/FormCotacao.tsx
// -----------------------------------------------------------------------------
// As telas do formulário da cotação (0158): preencher (NovaSolicitacao e
// "Enviar ajustes") e ler (SolicitacaoDetalhe). Regras e textos em cotacao.ts.
// -----------------------------------------------------------------------------
import type { ReactNode } from "react";
import { Campo, Entrada } from "@/rel/ui";
import {
  ACOMODACOES, CATEGORIAS_HOTEL, CLASSES, HORARIOS, INVESTIMENTOS, PEDIDOS, PERFIS, REGIMES, SERVICOS_ALTERAR,
  blocos, secoesDaCotacao, type FormCotacao,
} from "./cotacao";
import { PRIORIDADE_SOL, type PrioridadeSol } from "./lib";

export function EscolherPrioridade({ valor, onMudar }: { valor: PrioridadeSol; onMudar: (p: PrioridadeSol) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Prioridade">
      {(Object.entries(PRIORIDADE_SOL) as [PrioridadeSol, string][]).map(([k, r]) => (
        <button key={k} type="button" role="radio" aria-checked={valor === k} onClick={() => onMudar(k)}
          className="rounded-full px-3 h-8 text-[12.5px] border"
          style={valor === k ? { background: k === "urgente" ? "var(--err-bg)" : "var(--rel-soft)", color: k === "urgente" ? "var(--err-ink)" : "var(--rel-ink)", borderColor: "transparent", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>{r}</button>
      ))}
    </div>
  );
}

/** Botões de escolha (um ou vários). */
function Chips({ opcoes, valor, onMudar, rotulo, varios }: {
  opcoes: (string | [string, string])[]; valor: string | string[]; onMudar: (v: string) => void; rotulo: string; varios?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role={varios ? "group" : "radiogroup"} aria-label={rotulo}>
      {opcoes.map((o) => {
        const [k, r] = typeof o === "string" ? [o, o] : o;
        const marcado = Array.isArray(valor) ? valor.includes(k) : valor === k;
        return (
          <button key={k} type="button" role={varios ? "checkbox" : "radio"} aria-checked={marcado} onClick={() => onMudar(k)}
            className="rounded-full px-3 h-8 text-[12.5px] border"
            style={marcado ? { background: "var(--rel-soft)", color: "var(--rel-ink)", borderColor: "var(--rel)", fontWeight: 600 } : { borderColor: "var(--line)", color: "var(--ink2)" }}>
            {r}
          </button>
        );
      })}
    </div>
  );
}

function SimNao({ valor, onMudar, rotulo }: { valor: boolean; onMudar: (v: boolean) => void; rotulo: string }) {
  return <Chips rotulo={rotulo} opcoes={[["s", "Sim"], ["n", "Não"]]} valor={valor ? "s" : "n"} onMudar={(v) => onMudar(v === "s")} />;
}

function Numero({ valor, onMudar, rotulo, min = 0 }: { valor: number; onMudar: (n: number) => void; rotulo: string; min?: number }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>{rotulo}</span>
      <span className="inline-flex items-center rounded-lg border" style={{ borderColor: "var(--line)" }}>
        <button type="button" className="w-8 h-9 text-[16px]" style={{ color: "var(--ink2)" }} aria-label={`Menos ${rotulo}`} onClick={() => onMudar(Math.max(min, valor - 1))}>−</button>
        <span className="w-8 text-center text-[14px] font-semibold" style={{ color: "var(--ink)" }} aria-live="polite">{valor}</span>
        <button type="button" className="w-8 h-9 text-[16px]" style={{ color: "var(--ink2)" }} aria-label={`Mais ${rotulo}`} onClick={() => onMudar(Math.min(60, valor + 1))}>+</button>
      </span>
    </label>
  );
}

/** Como o Campo, mas sem <label> (pra grupos de botões). */
function Grupo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>{rotulo}</p>
      {children}
      {dica && <p className="text-[11px] mt-1" style={{ color: "var(--ink3)" }}>{dica}</p>}
    </div>
  );
}

function Parte({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <fieldset className="rel-card p-3 space-y-3">
      <legend className="px-1 text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{n}ª parte · {titulo}</legend>
      {children}
    </fieldset>
  );
}

export default function FormCotacaoCampos({ f, onMudar, prioridade, onPrioridade }: {
  f: FormCotacao;
  onMudar: (f: FormCotacao) => void;
  prioridade: PrioridadeSol;
  onPrioridade: (p: PrioridadeSol) => void;
}) {
  const mudar = <K extends keyof FormCotacao>(k: K, v: FormCotacao[K]) => onMudar({ ...f, [k]: v });
  const b = blocos(f);
  const viagemRotulos = f.pedido === "hospedagem" ? ["Entrada (check-in)", "Saída (check-out)"] : ["Ida", f.pedido === "aereo" ? "Volta (vazio = só ida)" : "Volta"];

  return (
    <div className="space-y-3">
      <Parte n={1} titulo="Cliente">
        <Campo rotulo="Nome do passageiro">
          <Entrada value={f.passageiro} onChange={(e) => mudar("passageiro", e.target.value)} maxLength={120} placeholder="Nome de quem viaja (o principal)" />
        </Campo>
        <Grupo rotulo="Prioridade"><EscolherPrioridade valor={prioridade} onMudar={onPrioridade} /></Grupo>
        <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Número de viajantes</p>
          <div className="flex flex-wrap items-end gap-4">
            <Numero rotulo="Adultos" valor={f.adultos} onMudar={(n) => mudar("adultos", n)} />
            <Numero rotulo="Crianças (2–11)" valor={f.criancas} onMudar={(n) => mudar("criancas", n)} />
            <Numero rotulo="Bebês (0–1)" valor={f.bebes} onMudar={(n) => mudar("bebes", n)} />
            {f.criancas > 0 && (
              <label className="block flex-1 min-w-[150px]">
                <span className="block text-[12px] font-semibold mb-1" style={{ color: "var(--ink2)" }}>Idade das crianças</span>
                <Entrada value={f.idades_criancas} onChange={(e) => mudar("idades_criancas", e.target.value)} maxLength={60} placeholder="Ex.: 4 e 9 anos" />
              </label>
            )}
          </div>
        </div>
        <Grupo rotulo="Perfil do cliente" dica="Marque todos que se aplicam.">
          <Chips rotulo="Perfil do cliente" varios opcoes={PERFIS} valor={f.perfil}
            onMudar={(k) => mudar("perfil", f.perfil.includes(k) ? f.perfil.filter((x) => x !== k) : [...f.perfil, k])} />
        </Grupo>
        <Campo rotulo="Comentário sobre o perfil (opcional)">
          <Entrada value={f.perfil_comentario} onChange={(e) => mudar("perfil_comentario", e.target.value)} maxLength={300}
            placeholder="Ex.: 25 anos de casados, gostam de vinho; já foram à Europa 3 vezes" />
        </Campo>
      </Parte>

      <Parte n={2} titulo="O que está sendo pedido">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5" role="radiogroup" aria-label="O que está sendo pedido">
          {PEDIDOS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={f.pedido === p.id} onClick={() => mudar("pedido", p.id)}
              className="rounded-lg px-3 py-2 text-left border"
              style={f.pedido === p.id ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : { borderColor: "var(--line)" }}>
              <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{p.rotulo}</span>
              <span className="block text-[11.5px] leading-tight" style={{ color: "var(--ink3)" }}>{p.dica}</span>
            </button>
          ))}
        </div>

        {b.viagem && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              {b.saida && (
                <Campo rotulo="Cidade de saída">
                  <Entrada value={f.saida} onChange={(e) => mudar("saida", e.target.value)} maxLength={80} placeholder="Ex.: São Paulo (GRU)" />
                </Campo>
              )}
              <Campo rotulo="Destino">
                <Entrada value={f.destino} onChange={(e) => mudar("destino", e.target.value)} maxLength={120} placeholder="Ex.: Japão — Tóquio, Kyoto e Osaka" />
              </Campo>
            </div>
            <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
              <input type="checkbox" checked={f.datas_flexiveis} onChange={(e) => mudar("datas_flexiveis", e.target.checked)} /> Datas flexíveis (ainda não tem data certa)
            </label>
            {f.datas_flexiveis ? (
              <Campo rotulo="Período aproximado">
                <Entrada value={f.periodo} onChange={(e) => mudar("periodo", e.target.value)} maxLength={120} placeholder="Ex.: segunda quinzena de março/2027, uns 12 dias" />
              </Campo>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo={viagemRotulos[0]}><input type="date" className="rel-input" value={f.ida} onChange={(e) => mudar("ida", e.target.value)} /></Campo>
                <Campo rotulo={viagemRotulos[1]}><input type="date" className="rel-input" value={f.volta} min={f.ida || undefined} onChange={(e) => mudar("volta", e.target.value)} /></Campo>
              </div>
            )}
            {b.passeios && (
              <Campo rotulo="Passeios e experiências" dica="O que o cliente quer viver lá.">
                <textarea className="rel-input" rows={2} maxLength={1500} value={f.passeios} onChange={(e) => mudar("passeios", e.target.value)}
                  placeholder="Ex.: Monte Fuji, cerimônia do chá, guia em português em Kyoto" />
              </Campo>
            )}
            {b.investimento && (
              <Grupo rotulo="Faixa de investimento por pessoa">
                <Chips rotulo="Faixa de investimento por pessoa" opcoes={INVESTIMENTOS} valor={f.investimento} onMudar={(v) => mudar("investimento", v)} />
              </Grupo>
            )}
          </div>
        )}

        {b.alteracao && (
          <div className="space-y-3">
            <Grupo rotulo={f.pedido === "correcao" ? "O que precisa corrigir" : "O que vai ser alterado"}>
              <Chips rotulo="Serviço" opcoes={SERVICOS_ALTERAR} valor={f.servico_alterar} onMudar={(v) => mudar("servico_alterar", v)} />
            </Grupo>
            <Campo rotulo="Localizador / nº da reserva (se tiver)">
              <Entrada value={f.localizador} onChange={(e) => mudar("localizador", e.target.value)} maxLength={60} placeholder="Ex.: SCIXQB" />
            </Campo>
            <Campo rotulo="Explique o que precisa mudar">
              <textarea className="rel-input" rows={3} maxLength={2000} value={f.o_que_mudar} onChange={(e) => mudar("o_que_mudar", e.target.value)}
                placeholder="Ex.: antecipar a volta de 26/03 para 24/03; o nome do passageiro saiu sem o sobrenome" />
            </Campo>
          </div>
        )}
      </Parte>

      {(b.perguntaHospedagem || b.hospedagem) && (
        <Parte n={3} titulo="Hospedagem">
          {b.perguntaHospedagem && <Grupo rotulo="Incluir hospedagem?"><SimNao rotulo="Incluir hospedagem" valor={f.hospedagem} onMudar={(v) => mudar("hospedagem", v)} /></Grupo>}
          {b.hospedagem && (
            <>
              <Grupo rotulo="Categoria desejada"><Chips rotulo="Categoria" opcoes={CATEGORIAS_HOTEL} valor={f.hotel_categoria} onMudar={(v) => mudar("hotel_categoria", v)} /></Grupo>
              <Grupo rotulo="Tipo de acomodação"><Chips rotulo="Acomodação" opcoes={ACOMODACOES} valor={f.acomodacao} onMudar={(v) => mudar("acomodacao", v)} /></Grupo>
              <Grupo rotulo="Regime alimentar"><Chips rotulo="Regime alimentar" opcoes={REGIMES} valor={f.regime} onMudar={(v) => mudar("regime", v)} /></Grupo>
              <Grupo rotulo="Possui hotel de preferência?"><SimNao rotulo="Hotel de preferência" valor={f.tem_hotel_pref} onMudar={(v) => mudar("tem_hotel_pref", v)} /></Grupo>
              {f.tem_hotel_pref && (
                <Campo rotulo="Qual hotel?">
                  <Entrada value={f.hotel_preferencia} onChange={(e) => mudar("hotel_preferencia", e.target.value)} maxLength={200} placeholder="Ex.: Park Hyatt Tokyo" />
                </Campo>
              )}
            </>
          )}
        </Parte>
      )}

      {(b.perguntaAereo || b.aereo) && (
        <Parte n={b.perguntaHospedagem || b.hospedagem ? 4 : 3} titulo="Aéreo">
          {b.perguntaAereo && <Grupo rotulo="Aéreo incluso?"><SimNao rotulo="Aéreo incluso" valor={f.aereo} onMudar={(v) => mudar("aereo", v)} /></Grupo>}
          {b.aereo && (
            <>
              <Grupo rotulo="Classe"><Chips rotulo="Classe" opcoes={CLASSES} valor={f.classe} onMudar={(v) => mudar("classe", v)} /></Grupo>
              <Campo rotulo="Preferência de companhia aérea (opcional)">
                <Entrada value={f.cia} onChange={(e) => mudar("cia", e.target.value)} maxLength={120} placeholder="Ex.: LATAM ou Emirates; evitar conexão nos EUA" />
              </Campo>
              <Grupo rotulo="Preferência de horário do voo"><Chips rotulo="Horário do voo" opcoes={HORARIOS} valor={f.horario} onMudar={(v) => mudar("horario", v)} /></Grupo>
            </>
          )}
        </Parte>
      )}

      {f.pedido && (
        <Campo rotulo="Observações (opcional)" dica="Tudo que o Operações precisa pra não ter que te perguntar.">
          <textarea className="rel-input" rows={3} maxLength={3000} value={f.observacoes} onChange={(e) => mudar("observacoes", e.target.value)} />
        </Campo>
      )}
    </div>
  );
}

/** O formulário preenchido, de leitura (no cartão aberto). */
export function VerCotacao({ f }: { f: FormCotacao }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2.5">
      {secoesDaCotacao(f).map((s) => (
        <section key={s.titulo} className="rounded-xl p-3" style={{ background: "var(--card2)" }} aria-label={s.titulo}>
          <h4 className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink3)" }}>{s.titulo}</h4>
          <dl className="space-y-1">
            {s.linhas.map(([r, v], i) => (
              <div key={i} className="text-[13px] leading-snug">
                {r && <dt className="inline font-semibold" style={{ color: "var(--ink2)" }}>{r}: </dt>}
                <dd className="inline whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

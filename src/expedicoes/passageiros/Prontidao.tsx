// src/expedicoes/passageiros/Prontidao.tsx
// Prontidão de embarque de um passageiro (app antigo: ProntidaoPaxDrawer.tsx —
// ProntidaoConteudo, RequisitoDrawer e ContratoDrawer). Lista as exigências do
// destino com o semáforo; clicar abre a gaveta do requisito (status, validade,
// anexos, responsável). Salvar grava tudo de uma vez (o antigo mandava 1 campo
// por chamada). Os requisitos nascem sozinhos no banco (trigger da 0166).
import { useRef, useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { Gaveta, Selo } from "../ui";
import { useExp } from "../contexto";
import Drive from "../drive/Drive";
import { STATUS_REQUISITO } from "../lib/constants";
import { ANEXO_OPCIONAL, REQUISITOS_COM_ANEXO_OBRIGATORIO, REQUISITOS_DE_COLUNA, type ChecagemProntidao, type ResultadoProntidao } from "../lib/prontidao/regras";
import { requisitosDoDestino } from "../lib/prontidao/requisitos-destino";
import { formatDate } from "../lib/utils";
import type { ArquivoRow, CategoriaArquivo, ExpedicaoRow, PassageiroRequisitoRow, PassageiroRow, StatusRequisito, TipoRequisito } from "../lib/database";
import { Opcao, Ponto, SeloProntidao, useVerArquivo } from "./pecas";
import { apagarArquivo, atualizarPassageiro, criarInstancia, enviarArquivo, espalharVacina, gerarRequisitos, salvarRequisito } from "./dados";

const ANEXO_CONFIG: Partial<Record<TipoRequisito, { categoria: CategoriaArquivo; label: string; dica: string; max?: number }>> = {
  Passaporte: { categoria: "Documentos pessoais", label: "Anexar foto/PDF do passaporte", dica: "Vale pra todas as expedições da pessoa." },
  "Ingresso Machu Picchu": { categoria: "Bilhetes", label: "Ingresso de Machu Picchu", dica: "Opcional — até 2 arquivos (imagem ou PDF).", max: 2 },
  "Ingresso Trem Machu Picchu": { categoria: "Bilhetes", label: "Ingresso do trem", dica: "Opcional — anexe os dois trechos (ida e volta)." },
  "Aéreo Internacional": { categoria: "Aéreos", label: "Voucher do aéreo", dica: "Anexar o voucher já deixa o aéreo aprovado." },
  "Aéreo Doméstico": { categoria: "Aéreos", label: "Voucher do aéreo", dica: "Anexar o voucher já deixa o aéreo aprovado." },
  "Voo Interno": { categoria: "Aéreos", label: "Voucher do voo interno", dica: "Anexar o voucher já deixa o aéreo aprovado." },
  Seguro: { categoria: "Seguros", label: "Apólice do seguro", dica: "Anexar a apólice já deixa o seguro aprovado." },
  Vacina: { categoria: "Documentos pessoais", label: "Certificado de vacinação", dica: "Anexar o certificado já deixa a vacina aprovada." },
};
const AEREOS = new Set<TipoRequisito>(["Aéreo Internacional", "Aéreo Doméstico", "Voo Interno"]);
const PERGUNTA_NECESSARIO: Partial<Record<TipoRequisito, string>> = {
  "Aéreo Doméstico": "É necessário aéreo doméstico?",
  "Voo Interno": "É necessário o voo interno?",
  Vacina: "É necessária a vacina?",
  Seguro: "Seguro contratado?",
};
const OBS_DISPENSA: Partial<Record<TipoRequisito, string>> = {
  Vacina: "Vacina não necessária", Seguro: "Seguro não contratado",
  "Voo Interno": "Voo interno não necessário", "Aéreo Doméstico": "Trecho doméstico não necessário",
};

type Base = { exp: ExpedicaoRow; pax: PassageiroRow; requisitos: PassageiroRequisitoRow[]; arquivos: ArquivoRow[]; onMudou: () => void };

/** Lista das exigências (usada na gaveta de prontidão e na aba Prontidão do passageiro). */
export function ProntidaoConteudo({ exp, pax, resultado, requisitos, arquivos, onMudou }: Base & { resultado?: ResultadoProntidao }) {
  const { somenteLeitura, avisar } = useExp();
  const [aberto, setAberto] = useState<{ tipo: "req"; req: PassageiroRequisitoRow } | { tipo: "contrato" } | null>(null);
  const [gerando, setGerando] = useState(false);

  if (!resultado) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Sem dados de prontidão para este passageiro (reserva cancelada).</p>;

  const clicar = async (c: ChecagemProntidao) => {
    if (somenteLeitura || c.tipo === "Dados Pessoais") return;
    if (c.tipo === "Contrato") { setAberto({ tipo: "contrato" }); return; }
    const inst = requisitos.find((r) => r.tipo === c.tipo);
    if (inst) { setAberto({ tipo: "req", req: inst }); return; }
    if (REQUISITOS_DE_COLUNA.has(c.tipo)) return;
    const tpl = requisitosDoDestino(exp.destino).find((t) => t.tipo === c.tipo);
    if (!tpl) { avisar(`Requisito "${c.tipo}" não previsto para ${exp.destino}.`, "erro"); return; }
    try { setAberto({ tipo: "req", req: await criarInstancia(pax.id, tpl) }); onMudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); }
  };

  return (
    <div>
      {requisitos.length === 0 && !somenteLeitura && exp.status !== "Concluída" && (
        <div className="mb-3 p-3 rounded-lg text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
          Requisitos de {exp.destino} ainda não criados para este passageiro.
          <Botao className="mt-2" disabled={gerando} onClick={async () => {
            setGerando(true);
            try { const n = await gerarRequisitos(exp.id); avisar(`Requisitos gerados (${n} itens)`); onMudou(); }
            catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } finally { setGerando(false); }
          }}>{gerando ? "Gerando…" : `Gerar requisitos de ${exp.destino}`}</Botao>
        </div>
      )}
      <ul className="divide-y rounded-xl border" style={{ borderColor: "var(--line)" }}>
        {resultado.checagens.map((c) => {
          const clicavel = !somenteLeitura && c.tipo !== "Dados Pessoais"
            && (c.tipo === "Contrato" || !!c.requisito_id || c.semaforo !== "na" || ANEXO_OPCIONAL.has(c.tipo));
          return (
            <li key={c.tipo} style={{ borderColor: "var(--line)" }}>
              <button type="button" disabled={!clicavel} onClick={() => void clicar(c)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left enabled:hover:bg-[var(--card2)] disabled:cursor-default">
                <Ponto s={c.semaforo} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{c.tipo}</span>
                  <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }} title={c.detalhe}>{c.detalhe}</span>
                </span>
                {clicavel && <span style={{ color: "var(--ink3)" }}>›</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {aberto?.tipo === "contrato" && <GavetaContrato exp={exp} pax={pax} onFechar={() => setAberto(null)} onMudou={onMudou} />}
      {aberto?.tipo === "req" && (
        <GavetaRequisito exp={exp} pax={pax} req={aberto.req} arquivos={arquivos} onMudou={onMudou} onFechar={() => setAberto(null)} />
      )}
    </div>
  );
}

/** Gaveta aberta pelo selo da tabela (#…/passageiros/prontidao/<paxId>). */
export function GavetaProntidao(p: Base & { resultado?: ResultadoProntidao; onFechar: () => void }) {
  return (
    <Gaveta aberta titulo={p.pax.nome_completo} onFechar={p.onFechar} largura={520}
      subtitulo={<span className="inline-flex items-center gap-2">Prontidão de embarque {p.resultado && <SeloProntidao p={p.resultado.prontidao} />}</span>}
      rodape={<Botao onClick={p.onFechar}>Fechar</Botao>}>
      <p className="text-[12px] mb-3" style={{ color: "var(--ink3)" }}>Clique numa exigência para editar ou anexar.</p>
      <ProntidaoConteudo {...p} />
    </Gaveta>
  );
}

function GavetaContrato({ exp, pax, onFechar, onMudou }: { exp: ExpedicaoRow; pax: PassageiroRow; onFechar: () => void; onMudou: () => void }) {
  const { avisar, somenteLeitura } = useExp();
  const [assinado, setAssinado] = useState(pax.contrato_assinado);
  return (
    <Gaveta aberta titulo="Contrato" subtitulo={pax.nome_completo} onFechar={onFechar} rodape={<Botao onClick={onFechar}>Fechar</Botao>}>
      <label className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
        <input type="checkbox" checked={assinado} disabled={somenteLeitura} onChange={async (e) => {
          const v = e.target.checked;
          setAssinado(v);
          try { await atualizarPassageiro(pax.id, { contrato_assinado: v }); avisar(v ? "Contrato marcado como assinado" : "Marcação de contrato removida"); onMudou(); }
          catch (er) { setAssinado(!v); avisar(er instanceof Error ? er.message : "Erro", "erro"); }
        }} />
        Contrato assinado
      </label>
      <p className="text-[12px] mt-3 mb-2" style={{ color: "var(--ink3)" }}>Anexe o PDF/imagem do contrato assinado. Fica na pasta "Contrato" do passageiro.</p>
      <Drive expedicaoId={exp.id} passageiroId={pax.id} somenteLeitura={somenteLeitura} pastaInicial="Contrato" categorias={["Contrato"]} onMudou={onMudou} />
    </Gaveta>
  );
}

function GavetaRequisito({ exp, pax, req, arquivos, onMudou, onFechar }: {
  exp: ExpedicaoRow; pax: PassageiroRow; req: PassageiroRequisitoRow; arquivos: ArquivoRow[]; onMudou: () => void; onFechar: () => void;
}) {
  const { usuarios, avisar, somenteLeitura } = useExp();
  const { ver, visor } = useVerArquivo();
  const input = useRef<HTMLInputElement>(null);
  const t = req.tipo;
  const cfg = ANEXO_CONFIG[t];
  const ehPassaporte = t === "Passaporte";
  const ehAereo = AEREOS.has(t);
  const ehQuestionario = ehAereo || t === "Vacina" || t === "Seguro";
  const perguntaNecessario = PERGUNTA_NECESSARIO[t];
  const multiplo = ehAereo || ANEXO_OPCIONAL.has(t);
  const exigeAnexo = REQUISITOS_COM_ANEXO_OBRIGATORIO.has(t);
  const generico = !ehQuestionario && !ehPassaporte && !ANEXO_OPCIONAL.has(t);

  const [status, setStatus] = useState<StatusRequisito>(req.status);
  const [validade, setValidade] = useState(req.validade?.slice(0, 10) ?? "");
  const [numero, setNumero] = useState(req.numero ?? "");
  const [responsavel, setResponsavel] = useState(req.responsavel_id ?? "");
  const [obs, setObs] = useState(req.observacoes ?? "");
  const [arquivoId, setArquivoId] = useState<string | null>(ehPassaporte ? pax.passaporte_arquivo_id : req.arquivo_id);
  const [necessario, setNecessario] = useState(!(perguntaNecessario && req.status === "Dispensado"));
  const [comprado, setComprado] = useState<boolean | null>(
    req.observacoes?.includes("Comprado com a gente: Sim") ? true : req.observacoes?.includes("Comprado com a gente: Não") ? false : null);
  const [novos, setNovos] = useState<ArquivoRow[]>([]);
  const [removidos, setRemovidos] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const todos = [...arquivos, ...novos].filter((a) => !removidos.has(a.id));
  const lista = multiplo && cfg ? todos.filter((a) => a.passageiro_id === pax.id && a.categoria === cfg.categoria && (a.descricao ?? "").startsWith(t)) : [];
  const unico = !multiplo ? todos.find((a) => a.id === arquivoId) ?? null : null;
  const lotado = cfg?.max != null && lista.length >= cfg.max;

  const gravarArquivoUnico = async (id: string | null) => {
    if (ehPassaporte) await atualizarPassageiro(pax.id, { passaporte_arquivo_id: id });
    else {
      await salvarRequisito(req.id, { arquivo_id: id });
      if (id && t === "Vacina") await espalharVacina(pax.cpf, id);
    }
    setArquivoId(id);
  };

  const anexar = async (files: FileList | null) => {
    if (!files?.length || !cfg) return;
    setEnviando(true);
    try {
      const sobe = multiplo ? [...files].slice(0, cfg.max ? cfg.max - lista.length : undefined) : [files[0]];
      const feitos: ArquivoRow[] = [];
      for (const f of sobe) feitos.push(await enviarArquivo(f, { expedicaoId: exp.id, passageiroId: pax.id, categoria: cfg.categoria, descricao: `${t} — prontidão` }));
      setNovos((n) => [...n, ...feitos]);
      if (!multiplo) {
        await gravarArquivoUnico(feitos[0].id);
        avisar(ehPassaporte ? "Passaporte anexado — vale em todas as expedições do passageiro." : "Anexado");
      } else {
        if (!arquivoId && feitos[0]) { await salvarRequisito(req.id, { arquivo_id: feitos[0].id }); setArquivoId(feitos[0].id); }
        avisar(feitos.length > 1 ? `${feitos.length} arquivos anexados` : "Anexado");
      }
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao anexar", "erro"); }
    finally { setEnviando(false); if (input.current) input.current.value = ""; }
  };

  const apagarDaLista = async (a: ArquivoRow) => {
    if (!window.confirm(`Apagar "${a.nome}"?`)) return;
    try {
      await apagarArquivo(a);
      setRemovidos((s) => new Set(s).add(a.id));
      if (arquivoId === a.id) {
        const outro = lista.find((x) => x.id !== a.id)?.id ?? null;
        await salvarRequisito(req.id, { arquivo_id: outro });
        setArquivoId(outro);
      }
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); }
  };

  const salvar = async () => {
    let statusFinal = status;
    let obsFinal: string | null = obs.trim() || null;
    if (ehQuestionario) {
      if (perguntaNecessario && !necessario) { statusFinal = "Dispensado"; obsFinal = OBS_DISPENSA[t] ?? obsFinal; }
      else {
        statusFinal = arquivoId ? "Aprovado" : "Pendente";
        if (ehAereo && comprado != null) obsFinal = `Comprado com a gente: ${comprado ? "Sim" : "Não"}`;
      }
    }
    const patch: Partial<PassageiroRequisitoRow> = {};
    if (statusFinal !== req.status && !ehPassaporte) patch.status = statusFinal;
    if (!ehPassaporte && (validade || null) !== (req.validade?.slice(0, 10) ?? null)) patch.validade = validade || null;
    if (!ehPassaporte && (numero.trim() || null) !== (req.numero ?? null)) patch.numero = numero.trim() || null;
    if ((responsavel || null) !== (req.responsavel_id ?? null)) patch.responsavel_id = responsavel || null;
    if ((obsFinal ?? null) !== (req.observacoes ?? null) && (ehQuestionario || generico)) patch.observacoes = obsFinal;
    if (Object.keys(patch).length === 0) { onFechar(); return; }
    setSalvando(true);
    try { await salvarRequisito(req.id, patch); avisar("Requisito atualizado"); onMudou(); onFechar(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
    finally { setSalvando(false); }
  };

  const verificador = req.verificado_por ? usuarios.find((u) => u.id === req.verificado_por)?.nome : null;

  return (
    <Gaveta aberta titulo={t} subtitulo={`${pax.nome_completo} — ${req.descricao}`} onFechar={onFechar} largura={520}
      rodape={<><Botao onClick={onFechar}>Fechar</Botao>{!somenteLeitura && <Botao variante="primario" disabled={salvando || enviando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar"}</Botao>}</>}>
      <div className="space-y-4">
        {ehQuestionario && perguntaNecessario && (
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>{perguntaNecessario}</p>
            <div className="flex gap-2">
              <Opcao ativo={necessario} onClick={() => setNecessario(true)} disabled={somenteLeitura}>Sim</Opcao>
              <Opcao ativo={!necessario} cor="nao" onClick={() => setNecessario(false)} disabled={somenteLeitura}>Não — dispensar</Opcao>
            </div>
          </div>
        )}
        {ehAereo && (!perguntaNecessario || necessario) && (
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Aéreo comprado com a gente?</p>
            <div className="flex gap-2">
              <Opcao ativo={comprado === true} onClick={() => setComprado(true)} disabled={somenteLeitura}>Sim</Opcao>
              <Opcao ativo={comprado === false} cor="nao" onClick={() => setComprado(false)} disabled={somenteLeitura}>Não</Opcao>
            </div>
            <p className="text-[11.5px] mt-1" style={{ color: "var(--ink3)" }}>Em qualquer caso, o voucher é obrigatório.</p>
          </div>
        )}

        {exigeAnexo && cfg && (!ehQuestionario || !perguntaNecessario || necessario) && (
          <div className="rounded-xl p-3 space-y-2" style={{ border: "1px solid var(--line)", background: "var(--card2)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>{cfg.label}</p>
            {multiplo ? (
              <>
                {lista.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Nenhum arquivo ainda.</p>}
                <ul className="space-y-1">
                  {lista.map((a) => (
                    <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                      <button className="flex-1 min-w-0 text-left truncate underline" style={{ color: "var(--rel-ink)" }} onClick={() => void ver(a)}>{a.nome}</button>
                      {a.id === arquivoId && <Selo tom="ok">comprovante</Selo>}
                      {!somenteLeitura && <button className="text-[12px]" style={{ color: "var(--err-ink)" }} onClick={() => void apagarDaLista(a)}>Apagar</button>}
                    </li>
                  ))}
                </ul>
              </>
            ) : unico ? (
              <div className="flex items-center gap-2 text-[12.5px]">
                <span style={{ color: "#166534" }}>✓ Anexado</span>
                <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => void ver(unico)}>Ver</button>
                {!somenteLeitura && <button style={{ color: "var(--err-ink)" }} onClick={async () => {
                  try { await gravarArquivoUnico(null); onMudou(); } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); }
                }}>Remover</button>}
              </div>
            ) : arquivoId ? <p className="text-[12.5px]" style={{ color: "#166534" }}>✓ Anexado</p> : null}
            {!somenteLeitura && !lotado && (!unico || multiplo) && (
              <>
                <input ref={input} type="file" accept="image/*,application/pdf" multiple={multiplo} className="hidden" onChange={(e) => void anexar(e.target.files)} />
                <Botao disabled={enviando} onClick={() => input.current?.click()}>{enviando ? "Enviando…" : multiplo && lista.length ? "Anexar mais" : "Anexar"}</Botao>
              </>
            )}
            <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{cfg.dica}</p>
          </div>
        )}

        {ehAereo && (!perguntaNecessario || necessario) && (
          <Campo rotulo="Localizador (opcional)"><Entrada value={numero} disabled={somenteLeitura} onChange={(e) => setNumero(e.target.value)} /></Campo>
        )}

        {generico && (
          <>
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Status</p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_REQUISITO.map((s) => <Opcao key={s} cor={s === "Aprovado" || s === "Dispensado" ? "sim" : s === "Reprovado" || s === "Vencido" ? "nao" : "neutro"} ativo={status === s} disabled={somenteLeitura} onClick={() => setStatus(s)}>{s}</Opcao>)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Validade"><Entrada type="date" value={validade} disabled={somenteLeitura} onChange={(e) => setValidade(e.target.value)} /></Campo>
              <Campo rotulo="Número / Localizador"><Entrada value={numero} disabled={somenteLeitura} onChange={(e) => setNumero(e.target.value)} /></Campo>
            </div>
            <Campo rotulo="Observações"><textarea className="rel-input" rows={3} value={obs} disabled={somenteLeitura} onChange={(e) => setObs(e.target.value)} /></Campo>
          </>
        )}

        <Campo rotulo="Responsável">
          <select className="rel-input" value={responsavel} disabled={somenteLeitura} onChange={(e) => setResponsavel(e.target.value)}>
            <option value="">— sem responsável —</option>
            {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </Campo>
        {req.verificado_em && (
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Verificado em {formatDate(req.verificado_em)}{verificador ? ` por ${verificador}` : ""}</p>
        )}
      </div>
      {visor}
    </Gaveta>
  );
}

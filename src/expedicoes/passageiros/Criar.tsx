// src/expedicoes/passageiros/Criar.tsx
// Entrada de passageiros na expedição (app antigo: NovoPassageiroDrawer,
// AdicionarExistenteDrawer e ImportarPassageirosDrawer modo "expedicao").
// Os requisitos de prontidão nascem sozinhos no banco (trigger da 0166).
import { useMemo, useState } from "react";
import { Botao, Campo, Entrada, Aviso } from "@/rel/ui";
import { Gaveta, Selo, Busca } from "../ui";
import { useExp } from "../contexto";
import { STATUS_RESERVA, TIPO_PASSAGEIRO } from "../lib/constants";
import { cpfValido, mascaraCpf } from "../lib/cpf";
import { mascaraTelefone, formatBRL } from "../lib/utils";
import { parsePassageirosCSV, cpfDigitos, type LinhaImport } from "../lib/csv/passageiros-import";
import type { PessoaAgregada } from "../lib/pessoas";
import type { StatusReserva, TipoPassageiro } from "../lib/database";
import { adicionarExistente, criarPassageiro, importarPassageiros } from "./dados";

export function NovoPassageiro({ expId, onFechar, onCriado }: { expId: string; onFechar: () => void; onCriado: () => void }) {
  const { avisar } = useExp();
  const [f, setF] = useState({ nome_completo: "", tipo: "Pagante" as TipoPassageiro, status_reserva: "Lead" as StatusReserva, cpf: "", data_nascimento: "", telefone: "", passaporte: "", validade_passaporte: "", email: "", observacoes: "" });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [indo, setIndo] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const salvar = async () => {
    const e: Record<string, string> = {};
    if (f.nome_completo.trim().length < 2) e.nome_completo = "Nome completo obrigatório";
    if (f.cpf && !cpfValido(f.cpf)) e.cpf = "CPF inválido";
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Email inválido";
    setErros(e);
    if (Object.keys(e).length) return;
    setIndo(true);
    try {
      const vazio = (s: string) => s.trim() || null;
      await criarPassageiro({
        expedicao_id: expId, nome_completo: f.nome_completo.trim(), tipo: f.tipo, status_reserva: f.status_reserva,
        cpf: vazio(f.cpf), data_nascimento: vazio(f.data_nascimento), telefone: vazio(f.telefone), passaporte: vazio(f.passaporte),
        validade_passaporte: vazio(f.validade_passaporte), email: vazio(f.email), observacoes: vazio(f.observacoes),
      });
      avisar("Passageiro adicionado");
      onCriado(); onFechar();
    } catch (er) { avisar(er instanceof Error ? er.message : "Erro", "erro"); }
    finally { setIndo(false); }
  };

  return (
    <Gaveta aberta titulo="Novo passageiro" subtitulo="Cadastro manual nesta expedição." onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={indo} onClick={salvar}>{indo ? "Salvando…" : "Adicionar"}</Botao></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Campo rotulo="Nome completo *" erro={erros.nome_completo}><Entrada autoFocus value={f.nome_completo} onChange={(e) => set("nome_completo", e.target.value)} /></Campo></div>
        <Campo rotulo="Tipo"><select className="rel-input" value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>{TIPO_PASSAGEIRO.map((t) => <option key={t}>{t}</option>)}</select></Campo>
        <Campo rotulo="Status"><select className="rel-input" value={f.status_reserva} onChange={(e) => set("status_reserva", e.target.value)}>{STATUS_RESERVA.map((t) => <option key={t}>{t}</option>)}</select></Campo>
        <Campo rotulo="CPF" erro={erros.cpf}><Entrada value={f.cpf} placeholder="000.000.000-00" onChange={(e) => set("cpf", mascaraCpf(e.target.value))} /></Campo>
        <Campo rotulo="Data de nascimento"><Entrada type="date" value={f.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} /></Campo>
        <Campo rotulo="Telefone"><Entrada value={f.telefone} onChange={(e) => set("telefone", mascaraTelefone(e.target.value))} /></Campo>
        <Campo rotulo="Email" erro={erros.email}><Entrada type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></Campo>
        <Campo rotulo="Passaporte"><Entrada value={f.passaporte} onChange={(e) => set("passaporte", e.target.value)} /></Campo>
        <Campo rotulo="Validade do passaporte"><Entrada type="date" value={f.validade_passaporte} onChange={(e) => set("validade_passaporte", e.target.value)} /></Campo>
        <div className="sm:col-span-2"><Campo rotulo="Observações"><textarea className="rel-input" rows={3} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></Campo></div>
      </div>
    </Gaveta>
  );
}

export function AdicionarExistente({ expId, pessoas, chavesNaExp, onFechar, onCriado }: {
  expId: string; pessoas: PessoaAgregada[] | null; chavesNaExp: Set<string>; onFechar: () => void; onCriado: () => void;
}) {
  const { avisar } = useExp();
  const [busca, setBusca] = useState("");
  const [feitos, setFeitos] = useState<Set<string>>(new Set());
  const [indo, setIndo] = useState<string | null>(null);
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (pessoas ?? [])
      .filter((p) => !chavesNaExp.has(p.chave) && !feitos.has(p.chave))
      .filter((p) => !t || `${p.nome_completo} ${p.cpf ?? ""} ${p.email ?? ""}`.toLowerCase().includes(t))
      .slice(0, 50);
  }, [pessoas, busca, chavesNaExp, feitos]);
  return (
    <Gaveta aberta titulo="Adicionar da base" subtitulo="Puxe alguém que já viajou ou está cadastrado na agência. Os dados pessoais vêm junto." onFechar={onFechar}
      rodape={<Botao onClick={onFechar}>Fechar</Botao>}>
      <Busca valor={busca} onMudar={setBusca} placeholder="Buscar por nome, CPF ou e-mail…" />
      {pessoas == null ? <p className="py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Carregando a base…</p> : (
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
          {lista.length === 0 && <li className="py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma pessoa encontrada (ou já está nesta expedição).</li>}
          {lista.map((p) => (
            <li key={p.chave} className="flex items-center gap-3 py-2" style={{ borderColor: "var(--line)" }}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>{p.nome_completo}</p>
                <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                  <span className="font-mono">{p.cpf || "sem CPF"}</span> · ✈ {p.totalExpedicoes} {p.totalExpedicoes === 1 ? "expedição" : "expedições"}
                </p>
              </div>
              <Botao disabled={indo === p.chave} onClick={async () => {
                setIndo(p.chave);
                try {
                  await adicionarExistente(expId, p.idsPassageiros[p.idsPassageiros.length - 1]);
                  setFeitos((s) => new Set(s).add(p.chave));
                  avisar(`${p.nome_completo} adicionado(a) à expedição`);
                  onCriado();
                } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } finally { setIndo(null); }
              }}>{indo === p.chave ? "…" : "Adicionar"}</Botao>
            </li>
          ))}
        </ul>
      )}
      {!busca && pessoas && <p className="text-[11.5px] mt-2" style={{ color: "var(--ink3)" }}>Mostrando as 50 primeiras em ordem alfabética — digite para buscar.</p>}
    </Gaveta>
  );
}

const MODELO = "nome_completo;data_nascimento;cpf;passaporte;validade_passaporte;email;telefone;tipo;status_reserva;valor_contratado;valor_pago\n"
  + "Maria Souza;15/03/1985;123.456.789-09;FZ123456;10/05/2030;maria@email.com;(11) 99999-0000;Pagante;Confirmado;18900;9450\n"
  + "João Lima;02/11/1990;;;;joao@email.com;(21) 98888-1111;Pagante;Pré-reserva;18900;0\n";

export function ImportarPassageiros({ expId, cpfsExistentes, onFechar, onCriado }: { expId: string; cpfsExistentes: Set<string>; onFechar: () => void; onCriado: () => void }) {
  const { avisar } = useExp();
  const [texto, setTexto] = useState("");
  const [indo, setIndo] = useState(false);
  const parse = useMemo(() => (texto.trim() ? parsePassageirosCSV(texto, { exigirObrigatorios: false, statusPadrao: "Confirmado" }) : null), [texto]);
  const classif = useMemo(() => {
    if (!parse) return [];
    const vistos = new Set<string>();
    return parse.linhas.map((l): { l: LinhaImport; sit: "ok" | "dup" | "erro"; motivo: string } => {
      if (l.erros.length) return { l, sit: "erro", motivo: l.erros.join("; ") };
      const d = cpfDigitos(l.dados.cpf);
      if (d && (cpfsExistentes.has(d) || vistos.has(d))) return { l, sit: "dup", motivo: "CPF já existe nesta expedição" };
      if (d) vistos.add(d);
      return { l, sit: "ok", motivo: "" };
    });
  }, [parse, cpfsExistentes]);
  const validos = classif.filter((c) => c.sit === "ok");

  const baixarModelo = () => {
    const url = URL.createObjectURL(new Blob(["﻿" + MODELO], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "modelo-passageiros.csv"; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Gaveta aberta largura={720} titulo="Importar passageiros (CSV)" subtitulo="Planilha do Excel salva como CSV (separada por ; ou ,). Sem status, entra como Confirmado." onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={!validos.length || indo} onClick={async () => {
          setIndo(true);
          try {
            const r = await importarPassageiros(expId, validos.map(({ l }) => ({ ...l.dados, expedicao_codigo: undefined })));
            const pulados = r.ignorados + (classif.length - validos.length);
            avisar(`${r.inseridos} passageiro(s) importado(s)${pulados ? ` · ${pulados} ignorado(s)` : ""}`);
            onCriado(); onFechar();
          } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } finally { setIndo(false); }
        }}>{indo ? "Importando…" : `Importar ${validos.length} válido(s)`}</Botao></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-semibold cursor-pointer" style={{ background: "var(--card)", border: "1px solid var(--line)", color: "var(--ink)" }}>
            Escolher arquivo
            <input type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setTexto(await f.text()); }} />
          </label>
          <Botao variante="fantasma" onClick={baixarModelo}>Baixar modelo</Botao>
        </div>
        <Campo rotulo="Ou cole o conteúdo do CSV">
          <textarea className="rel-input font-mono text-[12px]" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Campo>
        {parse?.erroGeral && <Aviso tom="erro">{parse.erroGeral}</Aviso>}
        {classif.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              <Selo tom="ok">{validos.length} válido(s)</Selo>
              <Selo tom="aviso">{classif.filter((c) => c.sit === "dup").length} duplicado(s)</Selo>
              <Selo tom="erro">{classif.filter((c) => c.sit === "erro").length} com erro</Selo>
            </div>
            <div className="overflow-auto rounded-lg" style={{ maxHeight: 320, border: "1px solid var(--line)" }}>
              <table className="w-full text-[12px]">
                <thead style={{ background: "var(--card2)", color: "var(--ink3)" }}>
                  <tr>{["#", "Nome", "CPF", "Nasc.", "Contratado", "Situação"].map((h) => <th key={h} className="text-left px-2 py-1.5 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {classif.map(({ l, sit, motivo }) => (
                    <tr key={l.linha} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="px-2 py-1">{l.linha}</td>
                      <td className="px-2 py-1">{l.dados.nome_completo || "—"}</td>
                      <td className="px-2 py-1 font-mono">{l.dados.cpf || "—"}</td>
                      <td className="px-2 py-1">{l.dados.data_nascimento ?? "—"}</td>
                      <td className="px-2 py-1">{l.dados.valor_contratado_brl != null ? formatBRL(l.dados.valor_contratado_brl) : "—"}</td>
                      <td className="px-2 py-1">
                        <Selo tom={sit === "ok" ? "ok" : sit === "dup" ? "aviso" : "erro"} titulo={motivo}>{sit === "ok" ? "Importar" : sit === "dup" ? "Duplicado" : "Erro"}</Selo>
                        {motivo && <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{motivo}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Linhas duplicadas ou com erro serão ignoradas. Os requisitos de prontidão do destino são criados automaticamente.</p>
          </>
        )}
      </div>
    </Gaveta>
  );
}

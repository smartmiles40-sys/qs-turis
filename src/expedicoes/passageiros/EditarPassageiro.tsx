// src/expedicoes/passageiros/EditarPassageiro.tsx
// Gaveta do passageiro (app antigo: EditarPassageiroDrawer.tsx). Três abas —
// Passageiro | Prontidão | Saúde — com UM formulário (Saúde salva no mesmo botão).
// Salvar chama exp_atualizar_passageiro: os dados PESSOAIS vão pra todas as
// reservas da pessoa. Embaixo: documentos (passaporte + Drive do pax), quarto e
// acompanhante, perfil, passeios/extensões, ExpedAmigo (admin), mudar de
// expedição e remover desta expedição.
import { useMemo, useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { Abas, BotaoExcluir, Gaveta } from "../ui";
import { useExp } from "../contexto";
import Drive from "../drive/Drive";
import { PASTAS_PAX } from "./pecas";
import { STATUS_RESERVA, TIPO_PASSAGEIRO } from "../lib/constants";
import { aniversarioNaViagem, formatDate, mascaraTelefone } from "../lib/utils";
import { mascaraCpf } from "../lib/cpf";
import type { ResultadoProntidao } from "../lib/prontidao/regras";
import type { ExpedicaoRow, PassageiroRow, SaudePassageiro, StatusReserva, TipoPassageiro } from "../lib/database";
import type { DadosAba } from "./dados";
import { atualizarPassageiro, espalharVacina, removerPassageiro } from "./dados";
import { ProntidaoConteudo } from "./Prontidao";
import SaudeCampos from "./SaudeCampos";
import { Bloco, LiberarExpedAmigo, MudarExpedicao, PassaporteAnexo, PasseiosEExtensoes, PerfilConexoes, QuartoAcompanhante } from "./blocos";
import { Ponto, SeloFidelidade } from "./pecas";

const CAMPOS_TEXTO = [
  "nome_completo", "cpf", "telefone", "passaporte", "validade_passaporte", "data_nascimento", "email", "observacoes",
  "endereco_cep", "endereco_rua", "endereco_numero", "endereco_complemento", "endereco_bairro", "endereco_cidade", "endereco_estado",
  "contato_emergencia_nome", "contato_emergencia_fone", "contato_emergencia_vinculo",
] as const;
type CampoTexto = (typeof CAMPOS_TEXTO)[number];
type Form = Record<CampoTexto, string> & { tipo: TipoPassageiro; status_reserva: StatusReserva; saude: SaudePassageiro };

function formDe(p: PassageiroRow): Form {
  const f = {} as Form;
  for (const c of CAMPOS_TEXTO) f[c] = ((p[c] as string | null) ?? "").slice(0, c === "validade_passaporte" || c === "data_nascimento" ? 10 : undefined);
  f.tipo = p.tipo; f.status_reserva = p.status_reserva; f.saude = { ...(p.saude ?? {}) };
  return f;
}

type Props = {
  exp: ExpedicaoRow; pax: PassageiroRow; dados: DadosAba; resultado?: ResultadoProntidao; posicao?: number; admin: boolean;
  onFechar: () => void; onMudou: () => void; onPerfil: () => void; onMovido: (novaExpId: string) => void;
};

export default function EditarPassageiro({ exp, pax, dados, resultado, posicao, admin, onFechar, onMudou, onPerfil, onMovido }: Props) {
  const { somenteLeitura, avisar } = useExp();
  const [aba, setAba] = useState<"dados" | "prontidao" | "saude">("dados");
  const inicial = useMemo(() => formDe(pax), [pax]);
  const [f, setF] = useState<Form>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState<Partial<Record<CampoTexto, string>>>({});
  const sujo = JSON.stringify(f) !== JSON.stringify(inicial);
  const set = (c: CampoTexto, v: string) => setF((x) => ({ ...x, [c]: v }));
  const aniv = aniversarioNaViagem(f.data_nascimento || null, exp.data_embarque, exp.data_retorno);

  const salvar = async () => {
    const e: typeof erros = {};
    if (f.nome_completo.trim().length < 2) e.nome_completo = "Mínimo 2 caracteres";
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Email inválido";
    setErros(e);
    if (Object.keys(e).length) { setAba("dados"); return; }
    const patch: Record<string, unknown> = {};
    for (const c of CAMPOS_TEXTO) if (f[c] !== inicial[c]) patch[c] = f[c].trim() || null;
    if (f.tipo !== inicial.tipo) patch.tipo = f.tipo;
    if (f.status_reserva !== inicial.status_reserva) patch.status_reserva = f.status_reserva;
    if (JSON.stringify(f.saude) !== JSON.stringify(inicial.saude)) {
      patch.saude = Object.fromEntries(Object.entries(f.saude).filter(([, v]) => v != null && String(v).trim() !== ""));
    }
    setSalvando(true);
    try {
      await atualizarPassageiro(pax.id, patch as Partial<PassageiroRow>);
      const cert = f.saude.vacina_febre_amarela_arquivo_id;
      if (cert && cert !== inicial.saude.vacina_febre_amarela_arquivo_id) await espalharVacina(f.cpf || pax.cpf, cert).catch(() => 0);
      avisar("Passageiro atualizado");
      onMudou();
      onFechar();
    } catch (er) { avisar(er instanceof Error ? er.message : "Erro ao salvar", "erro"); }
    finally { setSalvando(false); }
  };

  const txt = (c: CampoTexto, rotulo: string, extra?: { tipo?: string; mascara?: (v: string) => string; placeholder?: string }) => (
    <Campo rotulo={rotulo} erro={erros[c]}>
      <Entrada type={extra?.tipo ?? "text"} value={f[c]} placeholder={extra?.placeholder} disabled={somenteLeitura}
        onChange={(e) => set(c, extra?.mascara ? extra.mascara(e.target.value) : e.target.value)} />
    </Campo>
  );

  return (
    <Gaveta aberta largura={640} onFechar={onFechar}
      titulo={pax.nome_completo}
      subtitulo={<span className="flex flex-wrap items-center gap-2">
        <SeloFidelidade posicao={posicao} />
        <span>Dados pessoais, prontidão e saúde do passageiro.</span>
        <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={onPerfil}>Abrir página completa</button>
      </span>}
      rodape={<>
        <Botao onClick={onFechar}>Fechar</Botao>
        {!somenteLeitura && <Botao variante="primario" disabled={!sujo || salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar alterações"}</Botao>}
      </>}>
      <Abas ativa={aba} onTrocar={setAba} abas={[
        { id: "dados", rotulo: "Passageiro" },
        { id: "prontidao", rotulo: "Prontidão" },
        { id: "saude", rotulo: "Saúde" },
      ]} />
      {resultado && aba !== "prontidao" && (
        <button className="mt-2 inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }} onClick={() => setAba("prontidao")}>
          <Ponto s={resultado.prontidao === "Apto" ? "ok" : resultado.prontidao === "Atenção" ? "atencao" : "bloqueio"} /> Prontidão: {resultado.prontidao}
        </button>
      )}

      <div className="mt-4">
        {aba === "dados" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">{txt("nome_completo", "Nome completo")}</div>
              <Campo rotulo="Tipo">
                <select className="rel-input" value={f.tipo} disabled={somenteLeitura} onChange={(e) => setF((x) => ({ ...x, tipo: e.target.value as TipoPassageiro }))}>
                  {TIPO_PASSAGEIRO.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Campo>
              <Campo rotulo="Status">
                <select className="rel-input" value={f.status_reserva} disabled={somenteLeitura} onChange={(e) => setF((x) => ({ ...x, status_reserva: e.target.value as StatusReserva }))}>
                  {STATUS_RESERVA.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Campo>
              {txt("cpf", "CPF", { mascara: mascaraCpf, placeholder: "000.000.000-00" })}
              {txt("telefone", "Telefone", { mascara: mascaraTelefone })}
              {txt("passaporte", "Passaporte")}
              {txt("validade_passaporte", "Validade do passaporte", { tipo: "date" })}
              {txt("data_nascimento", "Data de nascimento", { tipo: "date" })}
              {txt("email", "Email", { tipo: "email" })}
            </div>
            <div className="rounded-lg px-3 py-2 text-[12.5px]" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
              <b>Aniversário na viagem: </b>
              {aniv ? `🎂 Faz aniversário em ${formatDate(aniv.data)}${aniv.idade != null ? ` (${aniv.idade} anos)` : ""}` : "Não faz aniversário durante esta viagem."}
            </div>
            <Campo rotulo="Observações">
              <textarea className="rel-input" rows={3} value={f.observacoes} disabled={somenteLeitura} onChange={(e) => set("observacoes", e.target.value)} />
            </Campo>
            <Bloco titulo="Contato de emergência">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {txt("contato_emergencia_nome", "Nome")}
                {txt("contato_emergencia_fone", "Telefone", { mascara: mascaraTelefone })}
                {txt("contato_emergencia_vinculo", "Vínculo")}
              </div>
            </Bloco>
            <Bloco titulo="Endereço">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {txt("endereco_cep", "CEP")}
                <div className="col-span-2">{txt("endereco_rua", "Rua / Logradouro")}</div>
                {txt("endereco_numero", "Número")}
                {txt("endereco_complemento", "Complemento")}
                {txt("endereco_bairro", "Bairro")}
                <div className="col-span-2">{txt("endereco_cidade", "Cidade")}</div>
                {txt("endereco_estado", "Estado (UF)")}
              </div>
            </Bloco>

            <Bloco titulo="Documentos do passageiro">
              <PassaporteAnexo exp={exp} pax={pax} arquivos={dados.arquivos} onMudou={onMudou} />
              <div className="mt-3"><Drive expedicaoId={exp.id} passageiroId={pax.id} somenteLeitura={somenteLeitura} categorias={PASTAS_PAX} onMudou={onMudou} /></div>
            </Bloco>
            <Bloco titulo="Quarto e acompanhante">
              <QuartoAcompanhante pax={pax} quartos={dados.quartos} alocacoes={dados.alocacoes} todos={dados.pax} />
            </Bloco>
            <PerfilConexoes pax={pax} fotoUrl={pax.foto_arquivo_id ? dados.fotos[pax.foto_arquivo_id] : null} />
            <PasseiosEExtensoes expId={exp.id} paxId={pax.id} />
            {admin && <LiberarExpedAmigo pax={pax} onMudou={onMudou} />}

            {!somenteLeitura && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t" style={{ borderColor: "var(--line)" }}>
                <MudarExpedicao exp={exp} pax={pax} onMovido={onMovido} />
                <span className="inline-flex items-center gap-1 text-[12.5px]" style={{ color: "var(--err-ink)" }}>
                  <BotaoExcluir icone={false} rotulo="Remover desta expedição" titulo={`Remover "${pax.nome_completo}" desta expedição?`}
                    descricao="Remove o passageiro apenas desta expedição. A pessoa continua no sistema (na base global e em outras expedições, se houver) e os arquivos dela ficam guardados. Para apagá-la de vez, use o perfil em Passageiros."
                    onConfirmar={async () => {
                      const r = await removerPassageiro(pax.id);
                      avisar(r === "avulso" ? "Removido da expedição — a pessoa continua na base." : "Removido desta expedição.");
                      onMudou(); onFechar();
                    }} />
                </span>
              </div>
            )}
          </div>
        )}
        {aba === "prontidao" && (
          <div>
            <p className="text-[12px] mb-3" style={{ color: "var(--ink3)" }}>Clique numa exigência para editar ou anexar.</p>
            <ProntidaoConteudo exp={exp} pax={pax} resultado={resultado} requisitos={dados.requisitos.filter((r) => r.passageiro_id === pax.id)} arquivos={dados.arquivos} onMudou={onMudou} />
          </div>
        )}
        {aba === "saude" && (
          <div>
            <p className="text-[12px] mb-3" style={{ color: "var(--ink3)" }}>Questionário de saúde — compartilhado entre as expedições da pessoa. Salve no botão abaixo.</p>
            <SaudeCampos value={f.saude} onChange={(s) => setF((x) => ({ ...x, saude: s }))} expedicaoId={exp.id} passageiroId={pax.id} />
          </div>
        )}
      </div>
    </Gaveta>
  );
}

// src/rel/clientes/ficha/PreencherPorTelefone.tsx
// -----------------------------------------------------------------------------
// "Preencher por telefone" (Bruno, 30/10): a cliente fala, a gente digita — UM
// formulário rápido com tudo que a próxima viagem pede, salvando CAMPO A CAMPO
// (ao sair do campo / ao clicar Sim-Não), cada gravação auditada:
//   dados pessoais, documentos, endereço → cad_salvar_pessoa (0213) → rel_auditoria
//   viagem, emergência, saúde          → cad_salvar_perfil (0228)  → rel_auditoria
// No topo: "Ficha X% completa · falta: …" (recalcula a cada campo) e o filtro
// "Só o que falta". Valor que veio de uma inscrição aparece preenchido com
// "da inscrição — Confirmar": só vai pra ficha quando alguém confirma ou muda.
// -----------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from "react";
import { Btn, StatusChip } from "@/components/ui";
import { Aviso, Modal } from "../../ui";
import type { Cliente } from "../../lib/clientes";
import {
  buscarCep, cpfValido, mascaraCep, mascaraCpf, mascaraTelefone, salvarPessoa, soDigitos,
  type CampoPessoa, type Pessoa,
} from "@/clientes/cadastro";
import { PERGUNTAS_SAUDE } from "@/expedicoes/lib/saude";
import type { SaudePassageiro } from "@/expedicoes/lib/database";
import {
  completudeProximaViagem, perfilEfetivo, salvarPerfil, PerfilInativo, TAMANHOS_CAMISETA,
  type CampoPerfil, type IdaCompleta, type PerfilViagem,
} from "./fontes";

type Estado = "salvando" | "salvo" | { erro: string } | undefined;
type ChaveTexto = Exclude<CampoPerfil, "saude" | "pref_marcar_assento" | "ja_viajou_internacional">;

function Status({ e }: { e: Estado }) {
  if (!e) return null;
  if (e === "salvando") return <span className="fc-tel__st" aria-live="polite">salvando…</span>;
  if (e === "salvo") return <span className="fc-tel__st fc-tel__st--ok" aria-live="polite">salvo ✓</span>;
  return <span className="fc-tel__st fc-tel__st--erro" role="alert">{e.erro}</span>;
}

function Linha({ id, rotulo, children, estado, dica }: { id: string; rotulo: string; children: ReactNode; estado?: Estado; dica?: ReactNode }) {
  return (
    <div className="fc-tel__campo">
      <label className="fc-label" htmlFor={id}>{rotulo}</label>
      {children}
      <span className="fc-tel__rodape">{dica}<Status e={estado} /></span>
    </div>
  );
}

const SN = ({ valor, onEscolher, rotulo, disabled }: { valor: string | boolean | undefined; onEscolher: (v: string) => void; rotulo: string; disabled?: boolean }) => (
  <span className="fc-inline" role="group" aria-label={rotulo}>
    {(["Sim", "Não"] as const).map((o) => {
      const ativo = valor === o || (o === "Sim" && valor === true) || (o === "Não" && valor === false);
      return (
        <button key={o} type="button" disabled={disabled} aria-pressed={ativo} className={`qs-btn2 qs-btn2--sm${ativo ? " qs-btn2--primary" : ""}`}
          onClick={() => onEscolher(ativo ? "" : o)}>{o}</button>
      );
    })}
  </span>
);

export default function PreencherPorTelefone({ aberto, c, pessoa, perfil, idas, semFoto, onFechar }: {
  aberto: boolean; c: Cliente; pessoa: Pessoa | null | undefined; perfil: PerfilViagem | null; idas: IdaCompleta[];
  semFoto: boolean | null; onFechar: (mudou: boolean) => void;
}) {
  const perfilAtivo = perfil !== null;
  const pe0 = useMemo(() => perfilEfetivo(perfil, idas), [perfil, idas]);
  const base: Pessoa | Cliente = pessoa ?? c;

  // dados da pessoa (0213)
  const [p, setP] = useState<Partial<Record<CampoPessoa, string>>>(() => ({
    nome: base.nome ?? "", cpf: base.cpf ? mascaraCpf(base.cpf) : "", nascimento: base.nascimento ?? "", telefone: base.telefone ? mascaraTelefone(base.telefone) : "",
    email: base.email ?? "", passaporte: base.passaporte ?? "", passaporte_validade: base.passaporte_validade ?? "",
    endereco_cep: pessoa?.endereco_cep ? mascaraCep(pessoa.endereco_cep) : "", endereco_rua: pessoa?.endereco_rua ?? "", endereco_numero: pessoa?.endereco_numero ?? "",
    endereco_complemento: pessoa?.endereco_complemento ?? "", endereco_bairro: pessoa?.endereco_bairro ?? "", endereco_cidade: pessoa?.endereco_cidade ?? "",
    endereco_estado: pessoa?.endereco_estado ?? "",
  }));
  const [pGravado, setPGravado] = useState(p);
  // perfil (0228): começa com o efetivo (ficha + última inscrição)
  const [pv, setPv] = useState<PerfilViagem>(() => {
    const o: PerfilViagem = {};
    for (const [k, v] of Object.entries(pe0)) if (k !== "saude" && v && typeof v === "object" && "valor" in v) (o as Record<string, unknown>)[k] = (v as { valor: unknown }).valor;
    o.saude = { ...pe0.saude.valor };
    if (o.contato_emergencia_fone) o.contato_emergencia_fone = mascaraTelefone(o.contato_emergencia_fone);
    return o;
  });
  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [soFalta, setSoFalta] = useState(false);
  const [mudou, setMudou] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const ok = (k: string) => setEstado((e) => ({ ...e, [k]: "salvo" }));
  const falhou = (k: string, err: unknown) => setEstado((e) => ({ ...e, [k]: { erro: err instanceof Error ? err.message : "não salvou" } }));

  async function gravarPessoa(campos: Partial<Record<CampoPessoa, string>>, chave: string) {
    if (!pessoa && !c) return;
    setEstado((e) => ({ ...e, [chave]: "salvando" }));
    try {
      const enviar = Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, k === "cpf" || k === "telefone" || k === "endereco_cep" ? soDigitos(v) : v]));
      await salvarPessoa(c.id, enviar);
      setPGravado((g) => ({ ...g, ...campos }));
      setMudou(true); ok(chave);
    } catch (e) { falhou(chave, e); }
  }

  function sairPessoa(k: CampoPessoa) {
    const v = (p[k] ?? "").trim();
    if (v === (pGravado[k] ?? "").trim()) return;
    if (k === "cpf" && v && !cpfValido(v)) { falhou(k, new Error("CPF inválido — confira os números.")); return; }
    if (k === "nome" && v.length < 2) { falhou(k, new Error("Nome muito curto.")); return; }
    void gravarPessoa({ [k]: v }, k);
  }

  async function sairCep() {
    const v = p.endereco_cep ?? "";
    if (v === (pGravado.endereco_cep ?? "")) return;
    const campos: Partial<Record<CampoPessoa, string>> = { endereco_cep: v };
    if (soDigitos(v).length === 8) {
      const r = await buscarCep(v);
      if (r) {
        const novo = {
          endereco_rua: p.endereco_rua || r.rua, endereco_bairro: p.endereco_bairro || r.bairro,
          endereco_cidade: p.endereco_cidade || r.cidade, endereco_estado: p.endereco_estado || r.estado,
        };
        setP((x) => ({ ...x, ...novo }));
        Object.assign(campos, novo);
      }
    }
    void gravarPessoa(campos, "endereco_cep");
  }

  async function gravarPerfil(campos: Partial<Record<CampoPerfil, unknown>>, chave: string) {
    if (!perfilAtivo) { setAviso(new PerfilInativo().message); return; }
    setEstado((e) => ({ ...e, [chave]: "salvando" }));
    try { await salvarPerfil(c.id, campos); setMudou(true); ok(chave); }
    catch (e) { falhou(chave, e); }
  }

  const gravadoNaFicha = (k: Exclude<CampoPerfil, "saude">) => pe0[k]?.origem === "ficha" ? pe0[k]!.valor : undefined;
  function sairPerfil(k: ChaveTexto) {
    const norm = (x: unknown) => (k === "contato_emergencia_fone" ? soDigitos(String(x ?? "")) : String(x ?? "").trim());
    const v = norm(pv[k]);
    const antes = norm(pe0[k]?.valor);
    if (v === antes) return; // não mudou: o valor da inscrição só vai com "Confirmar"
    void gravarPerfil({ [k]: v }, k);
  }
  const confirmar = (k: Exclude<CampoPerfil, "saude">) =>
    void gravarPerfil({ [k]: k === "contato_emergencia_fone" ? soDigitos(String(pv[k] ?? "")) : pv[k] }, k);

  function escolherSaude(campo: keyof SaudePassageiro, v: string) {
    const nova = { ...(pv.saude ?? {}), [campo]: v } as SaudePassageiro;
    setPv((x) => ({ ...x, saude: nova }));
    // manda a saúde INTEIRA (a da inscrição vira da ficha na 1ª gravação; "" apaga a chave)
    void gravarPerfil({ saude: nova }, `saude.${campo}`);
  }
  function sairDetalheSaude(campo: keyof SaudePassageiro) {
    const v = String(pv.saude?.[campo] ?? "");
    if (v === String(pe0.saude.valor[campo] ?? "") && !estado[`saude.${campo}`]) return;
    void gravarPerfil({ saude: pv.saude ?? {} }, `saude.${campo}`);
  }

  // completude ao vivo
  const comp = useMemo(() => {
    const c2 = { ...c, nome: p.nome ?? "", cpf: soDigitos(p.cpf) || null, nascimento: p.nascimento || null, telefone: soDigitos(p.telefone) || null,
      email: p.email || null, passaporte: p.passaporte || null, passaporte_validade: p.passaporte_validade || null } as Cliente;
    const pes2 = { ...(pessoa ?? {}), endereco_cep: p.endereco_cep || null, endereco_rua: p.endereco_rua || null, endereco_cidade: p.endereco_cidade || null } as Pessoa;
    return completudeProximaViagem(c2, pes2, perfilEfetivo(pv, []), semFoto);
  }, [c, p, pessoa, pv, semFoto]);
  const faltaChaves = new Set(comp.falta.map((f) => f.chave));
  const mostra = (chave: string) => !soFalta || faltaChaves.has(chave);

  const inPessoa = (k: CampoPessoa, rotulo: string, extra: { tipo?: string; mascara?: (v: string) => string; dica?: ReactNode; auto?: string; chaveFalta?: string } = {}) =>
    mostra(extra.chaveFalta ?? k) && (
      <Linha id={`tel-${k}`} rotulo={rotulo} estado={estado[k]} dica={extra.dica}>
        <input id={`tel-${k}`} className="fc-input" type={extra.tipo ?? "text"} autoComplete={extra.auto ?? "off"} value={p[k] ?? ""}
          onChange={(e) => setP((x) => ({ ...x, [k]: extra.mascara ? extra.mascara(e.target.value) : e.target.value }))}
          onBlur={() => (k === "endereco_cep" ? void sairCep() : sairPessoa(k))} />
      </Linha>
    );

  const inPerfil = (k: ChaveTexto, rotulo: string, extra: { tipo?: string; mascara?: (v: string) => string; chaveFalta?: string; opcoes?: string[] } = {}) => {
    if (!mostra(extra.chaveFalta ?? k)) return null;
    const daInscricao = pe0[k]?.origem === "inscricao" && gravadoNaFicha(k) === undefined && estado[k] !== "salvo";
    return (
      <Linha id={`tel-${k}`} rotulo={rotulo} estado={estado[k]}
        dica={daInscricao ? <span className="fc-inline">da inscrição de {pe0[k]?.ida?.expedicao?.nome ?? "uma viagem"}
          <button type="button" className="fc-link fc-link--btn" disabled={!perfilAtivo} onClick={() => confirmar(k)}>Confirmar</button></span> : undefined}>
        {extra.opcoes ? (
          <select id={`tel-${k}`} className="fc-input" value={String(pv[k] ?? "")} disabled={!perfilAtivo}
            onChange={(e) => { const v = e.target.value; setPv((x) => ({ ...x, [k]: v })); void gravarPerfil({ [k]: v }, k); }}>
            <option value="">—</option>
            {extra.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input id={`tel-${k}`} className="fc-input" type={extra.tipo ?? "text"} value={String(pv[k] ?? "")} disabled={!perfilAtivo}
            onChange={(e) => { const v = extra.mascara ? extra.mascara(e.target.value) : e.target.value; setPv((x) => ({ ...x, [k]: v })); }}
            onBlur={() => sairPerfil(k)} />
        )}
      </Linha>
    );
  };

  const inBool = (k: "pref_marcar_assento" | "ja_viajou_internacional", rotulo: string) => !soFalta && (
    <Linha id={`tel-${k}`} rotulo={rotulo} estado={estado[k]}>
      <SN rotulo={rotulo} valor={pv[k]} disabled={!perfilAtivo}
        onEscolher={(v) => { const b = v === "" ? null : v === "Sim"; setPv((x) => ({ ...x, [k]: b ?? undefined })); void gravarPerfil({ [k]: b }, k); }} />
    </Linha>
  );

  const fechar = () => onFechar(mudou);

  return (
    <Modal aberto={aberto} titulo={`Preencher por telefone — ${c.nome.split(" ")[0]}`} onFechar={fechar} largura={820}
      rodape={<Btn variant="primary" onClick={fechar}>Pronto</Btn>}>
      <div className="fc-tel">
        <div className="fc-tel__topo" role="status">
          <span className="fc-tel__pct">
            <strong className="qs-num">Ficha {comp.pct}% completa</strong>
            {comp.falta.length > 0
              ? <span className="fc-bloco__s"> · falta: {comp.falta.map((f) => f.rotulo).join(", ")}</span>
              : <span className="fc-bloco__s"> · pronta pra próxima viagem</span>}
          </span>
          <span className="fc-tel__barra" aria-hidden><span style={{ width: `${comp.pct}%` }} /></span>
          <label className="fc-inline fc-bloco__s">
            <input type="checkbox" checked={soFalta} onChange={(e) => setSoFalta(e.target.checked)} /> Só o que falta
          </label>
        </div>
        <p className="fc-bloco__s" style={{ margin: 0 }}>Cada campo salva sozinho quando você sai dele (ou clica Sim/Não). Tudo fica no histórico da ficha.</p>
        {aviso && <Aviso>{aviso}</Aviso>}
        {!perfilAtivo && <Aviso>Emergência, camiseta, preferências e saúde só gravam na ficha depois da migration 0228. Dados pessoais, documentos e endereço já gravam.</Aviso>}

        <fieldset className="fc-tel__grupo">
          <legend>Dados pessoais</legend>
          <div className="fc-tel__grade">
            {inPessoa("nome", "Nome completo")}
            {inPessoa("cpf", "CPF", { mascara: mascaraCpf })}
            {inPessoa("nascimento", "Nascimento", { tipo: "date" })}
            {inPessoa("telefone", "Telefone (com DDD)", { mascara: mascaraTelefone, tipo: "tel" })}
            {inPessoa("email", "E-mail", { tipo: "email" })}
          </div>
        </fieldset>

        <fieldset className="fc-tel__grupo">
          <legend>Passaporte</legend>
          <div className="fc-tel__grade">
            {inPessoa("passaporte", "Número do passaporte", { mascara: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) })}
            {inPessoa("passaporte_validade", "Validade", { tipo: "date", dica: "precisa valer 6 meses depois da volta" })}
          </div>
          {semFoto === true && mostra("doc_passaporte") && <p className="fc-bloco__s" style={{ margin: "6px 0 0" }}>Falta a foto do passaporte — peça pelo WhatsApp ou suba na aba Documentos.</p>}
        </fieldset>

        {(mostra("endereco")) && (
          <fieldset className="fc-tel__grupo">
            <legend>Endereço</legend>
            <div className="fc-tel__grade">
              {inPessoa("endereco_cep", "CEP", { mascara: mascaraCep, dica: "preenche rua, bairro e cidade", chaveFalta: "endereco" })}
              {inPessoa("endereco_rua", "Rua", { chaveFalta: "endereco" })}
              {inPessoa("endereco_numero", "Número", { chaveFalta: "endereco" })}
              {inPessoa("endereco_complemento", "Complemento", { chaveFalta: "endereco" })}
              {inPessoa("endereco_bairro", "Bairro", { chaveFalta: "endereco" })}
              {inPessoa("endereco_cidade", "Cidade", { chaveFalta: "endereco" })}
              {inPessoa("endereco_estado", "UF", { mascara: (v) => v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2), chaveFalta: "endereco" })}
            </div>
          </fieldset>
        )}

        <fieldset className="fc-tel__grupo">
          <legend>Viagem</legend>
          <div className="fc-tel__grade">
            {inPerfil("contato_emergencia_nome", "Emergência: nome", { chaveFalta: "emergencia" })}
            {inPerfil("contato_emergencia_fone", "Emergência: telefone", { mascara: mascaraTelefone, tipo: "tel", chaveFalta: "emergencia" })}
            {inPerfil("contato_emergencia_vinculo", "Emergência: vínculo", { chaveFalta: "emergencia" })}
            {inPerfil("camiseta", "Tamanho de camiseta", { opcoes: TAMANHOS_CAMISETA })}
            {!soFalta && inPerfil("restricoes_alimentares", "Alimentação (observação livre)")}
            {!soFalta && inPerfil("profissao", "Profissão")}
            {!soFalta && inPerfil("instagram", "Instagram")}
            {!soFalta && inPerfil("pref_upgrade_classe", "Upgrade de classe (interesse)")}
            {!soFalta && inPerfil("paises_visitados", "Países que já visitou")}
            {inBool("pref_marcar_assento", "Quer marcar assento?")}
            {inBool("ja_viajou_internacional", "Já viajou pra fora?")}
            {!soFalta && inPerfil("obs_viagem", "Observações de viagem")}
          </div>
        </fieldset>

        {mostra("saude") && (
          <fieldset className="fc-tel__grupo">
            <legend>Saúde {pe0.saude.origem === "inscricao" && <StatusChip>da inscrição de {pe0.saude.ida?.expedicao?.nome ?? "uma viagem"}</StatusChip>}</legend>
            <div className="fc-tel__saude">
              {PERGUNTAS_SAUDE.map((q) => {
                const val = String(pv.saude?.[q.campo] ?? "");
                if (soFalta && val) return null;
                const k = `saude.${q.campo}`;
                return (
                  <div key={q.campo} className="fc-tel__q">
                    <span className="fc-tel__qt">{q.pergunta}</span>
                    <span className="fc-inline">
                      <SN rotulo={q.curto} valor={val} disabled={!perfilAtivo} onEscolher={(v) => escolherSaude(q.campo, v)} />
                      <Status e={estado[k]} />
                    </span>
                    {val === "Sim" && q.detalheCampo && (
                      <input aria-label={q.detalhePergunta ?? "Detalhe"} placeholder={q.detalhePergunta} className="fc-input" disabled={!perfilAtivo}
                        value={String(pv.saude?.[q.detalheCampo] ?? "")}
                        onChange={(e) => { const v = e.target.value; setPv((x) => ({ ...x, saude: { ...(x.saude ?? {}), [q.detalheCampo!]: v } })); }}
                        onBlur={() => sairDetalheSaude(q.detalheCampo!)} />
                    )}
                    {val === "Sim" && q.detalhe2Campo && (
                      <input aria-label={q.detalhe2Pergunta ?? "Detalhe"} placeholder={q.detalhe2Pergunta} className="fc-input" disabled={!perfilAtivo}
                        value={String(pv.saude?.[q.detalhe2Campo] ?? "")}
                        onChange={(e) => { const v = e.target.value; setPv((x) => ({ ...x, saude: { ...(x.saude ?? {}), [q.detalhe2Campo!]: v } })); }}
                        onBlur={() => sairDetalheSaude(q.detalhe2Campo!)} />
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

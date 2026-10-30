// src/rel/clientes/ficha/PreencherPorTelefone.tsx
// -----------------------------------------------------------------------------
// "Preencher por telefone" (Bruno, 30/10): a cliente fala, a gente digita — UM
// formulário rápido com tudo que a próxima viagem pede, salvando CAMPO A CAMPO
// (ao sair do campo / ao clicar Sim-Não), cada gravação auditada:
//   dados pessoais, documentos, endereço → cad_salvar_pessoa (0213) → rel_auditoria
//   viagem, emergência, saúde, RG/sexo/nacionalidade/nome no passaporte/milhas
//                                         → cad_salvar_perfil (0228/0232) → rel_auditoria
// No topo: "X% do que dá por telefone · falta: …" e, à parte, o que só a cliente
// manda ("pedir ao cliente": foto do passaporte). Valor que veio de uma inscrição
// aparece preenchido com "da inscrição — Confirmar": só vai pra ficha quando alguém
// confirma ou muda.
//
// Revisão de 30/10 (o que mudou):
//   • "Só o que falta" CONGELA a lista quando é ligado, a partir do que está
//     GRAVADO (antes o campo sumia na 1ª letra; o "Qual?" da saúde nunca aparecia).
//   • Cada campo compara com o ÚLTIMO GRAVADO (A→B→A agora salva a volta pra A).
//   • Data incompleta nunca grava "" (não apaga nascimento/validade); apagar = "Limpar".
//   • Saúde: manda só a chave que mudou, numa fila (uma gravação de cada vez). Na 1ª,
//     se a saúde veio da inscrição, leva a inscrição inteira junto (senão o resto se perde).
//   • Teclado: CPF/CEP/telefone numéricos, foco no 1º campo, Enter passa pro próximo,
//     emergência aceita número do exterior (+, até 15 dígitos).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
  completudeProximaViagem, perfilEfetivo, salvarPerfil, PerfilInativo, SEXOS, TAMANHOS_CAMISETA,
  type CampoPerfil, type IdaCompleta, type PerfilViagem, type ProgramaMilhas,
} from "./fontes";
import { dataValida, normalizarFoneEmergencia } from "./regras";

type Estado = "salvando" | "salvo" | { erro: string } | undefined;
type ChaveTexto = Exclude<CampoPerfil, "saude" | "pref_marcar_assento" | "ja_viajou_internacional" | "milhas">;
type ChaveBool = "pref_marcar_assento" | "ja_viajou_internacional";

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

const temValor = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : v != null);
/** Telefone de emergência: com "+" é do exterior (sem máscara do Brasil). */
const mascaraFoneEmergencia = (v: string) => (v.trim().startsWith("+") ? normalizarFoneEmergencia(v) : mascaraTelefone(v));
const normPerfil = (k: string, x: unknown) =>
  k === "contato_emergencia_fone" ? normalizarFoneEmergencia(String(x ?? "")) : typeof x === "boolean" ? String(x) : String(x ?? "").trim();
const DATAS: CampoPessoa[] = ["nascimento", "passaporte_validade"];

export default function PreencherPorTelefone({ aberto, c, pessoa, perfil, perfilErro, idas, semFoto, voltaReferencia, onFechar }: {
  aberto: boolean; c: Cliente;
  /** já carregada: null = cadastro único fora do ar */
  pessoa: Pessoa | null;
  /** já carregado: null = a 0228 não está no banco */
  perfil: PerfilViagem | null;
  /** o perfil não carregou (rede/permissão): os campos do perfil ficam travados */
  perfilErro?: string | null;
  idas: IdaCompleta[];
  semFoto: boolean | null; voltaReferencia: string | null; onFechar: (mudou: boolean) => void;
}) {
  const perfilAtivo = perfil !== null && !perfilErro;
  const pe0 = useMemo(() => perfilEfetivo(perfil, idas), [perfil, idas]);
  const base: Pessoa | Cliente = pessoa ?? c;
  const caixa = useRef<HTMLDivElement>(null);

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
    for (const [k, v] of Object.entries(pe0)) {
      if (k === "saude" || k === "milhas") continue;
      if (v && typeof v === "object" && "valor" in v) (o as Record<string, unknown>)[k] = (v as { valor: unknown }).valor;
    }
    if (o.contato_emergencia_fone) o.contato_emergencia_fone = mascaraFoneEmergencia(o.contato_emergencia_fone);
    return o;
  });
  // o último valor GRAVADO (ou o que veio carregado) de cada campo do perfil — compara com ele, não com a abertura
  const [pvGravado, setPvGravado] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(pv).map(([k, v]) => [k, normPerfil(k, v)])));
  const [saude, setSaude] = useState<SaudePassageiro>(() => ({ ...pe0.saude.valor }));
  const [saudeG, setSaudeG] = useState<SaudePassageiro>(() => ({ ...pe0.saude.valor }));
  const [milhas, setMilhas] = useState<ProgramaMilhas[]>(() => (pe0.milhas?.valor ?? []).map((m) => ({ ...m })));
  const [milhasG, setMilhasG] = useState(() => JSON.stringify(pe0.milhas?.valor ?? []));

  const [estado, setEstado] = useState<Record<string, Estado>>({});
  const [soFalta, setSoFalta] = useState(false);
  const [congelado, setCongelado] = useState<{ chaves: Set<string>; saude: Set<string> } | null>(null);
  const [mudou, setMudou] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // a saúde grava numa fila: um clique não atropela o outro
  const filaSaude = useRef<Promise<void>>(Promise.resolve());
  const saudeSemeada = useRef(pe0.saude.origem !== "inscricao");

  const ok = (k: string) => setEstado((e) => ({ ...e, [k]: "salvo" }));
  const falhou = (k: string, err: unknown) => setEstado((e) => ({ ...e, [k]: { erro: err instanceof Error ? err.message : "não salvou" } }));

  // foco no 1º campo ao abrir
  useEffect(() => {
    const t = setTimeout(() => caixa.current?.querySelector<HTMLInputElement>("input:not([disabled]):not([type=checkbox])")?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  /** Enter passa pro próximo campo (o blur do atual salva). */
  function enterProximo(e: KeyboardEvent<HTMLDivElement>) {
    const alvo = e.target as HTMLElement;
    if (e.key !== "Enter" || e.shiftKey || !(alvo instanceof HTMLInputElement || alvo instanceof HTMLSelectElement)) return;
    if (alvo instanceof HTMLInputElement && (alvo.type === "checkbox" || alvo.type === "file")) return;
    const lista = [...(caixa.current?.querySelectorAll<HTMLElement>("input:not([disabled]):not([type=checkbox]):not([type=file]), select:not([disabled])") ?? [])];
    const i = lista.indexOf(alvo);
    if (i < 0) return;
    e.preventDefault();
    (lista[i + 1] ?? alvo).focus();
    if (!lista[i + 1]) alvo.blur();
  }

  async function gravarPessoa(campos: Partial<Record<CampoPessoa, string>>, chave: string) {
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
    if (v === (pGravado[k] ?? "").trim()) { if (estado[k] && typeof estado[k] === "object") setEstado((e) => ({ ...e, [k]: undefined })); return; }
    if (DATAS.includes(k)) {
      // input date incompleto devolve "": nunca grava "" daqui (apagar é o botão "Limpar")
      if (!v) { falhou(k, new Error("Data incompleta — não salvei. Pra apagar, use Limpar.")); return; }
      if (!dataValida(v)) { falhou(k, new Error("Data inválida — confira dia, mês e ano.")); return; }
    }
    if (k === "cpf" && v && !cpfValido(v)) { falhou(k, new Error("CPF inválido — confira os números.")); return; }
    if (k === "nome" && v.length < 2) { falhou(k, new Error("Nome muito curto.")); return; }
    void gravarPessoa({ [k]: v }, k);
  }
  function limparData(k: CampoPessoa) {
    setP((x) => ({ ...x, [k]: "" }));
    void gravarPessoa({ [k]: "" }, k);
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

  async function gravarPerfil(campos: Partial<Record<CampoPerfil, unknown>>, chave: string): Promise<boolean> {
    if (!perfilAtivo) { setAviso(perfilErro ? `O perfil de viagem não carregou (${perfilErro}). Feche e tente de novo.` : new PerfilInativo().message); return false; }
    setEstado((e) => ({ ...e, [chave]: "salvando" }));
    try { await salvarPerfil(c.id, campos); setMudou(true); ok(chave); return true; }
    catch (e) { falhou(chave, e); return false; }
  }

  async function gravarCampoPerfil(k: ChaveTexto | ChaveBool, valor: unknown) {
    const enviar = k === "contato_emergencia_fone" ? normalizarFoneEmergencia(String(valor ?? "")) : valor;
    if (await gravarPerfil({ [k]: enviar }, k)) setPvGravado((g) => ({ ...g, [k]: normPerfil(k, valor) }));
  }

  const gravadoNaFicha = (k: Exclude<CampoPerfil, "saude">) => pe0[k]?.origem === "ficha" ? pe0[k]!.valor : undefined;
  function sairPerfil(k: ChaveTexto) {
    // compara com o ÚLTIMO GRAVADO: A→B→A salva a volta pra A; o valor da inscrição
    // intocado não grava sozinho (só com "Confirmar")
    if (normPerfil(k, pv[k]) === (pvGravado[k] ?? "")) return;
    void gravarCampoPerfil(k, pv[k]);
  }
  const confirmar = (k: ChaveTexto) => void gravarCampoPerfil(k, pv[k]);

  /** Saúde: só a chave que mudou (a RPC mescla), uma gravação de cada vez. */
  function gravarSaude(mud: Partial<SaudePassageiro>, chave: string) {
    filaSaude.current = filaSaude.current.then(async () => {
      const semear = !saudeSemeada.current;
      const enviar = semear ? { ...pe0.saude.valor, ...mud } : mud; // 1ª vez com saúde da inscrição: leva ela toda
      if (await gravarPerfil({ saude: enviar }, chave)) {
        saudeSemeada.current = true;
        setSaudeG((g) => {
          const n = { ...(semear ? pe0.saude.valor : g), ...mud } as Record<string, unknown>;
          for (const [k, v] of Object.entries(mud)) if (!temValor(v)) delete n[k];
          return n as SaudePassageiro;
        });
      }
    });
  }
  function escolherSaude(campo: keyof SaudePassageiro, v: string) {
    setSaude((x) => ({ ...x, [campo]: v }));
    gravarSaude({ [campo]: v } as Partial<SaudePassageiro>, `saude.${campo}`);
  }
  function sairDetalheSaude(campo: keyof SaudePassageiro, pergunta: keyof SaudePassageiro) {
    const v = String(saude[campo] ?? "").trim();
    if (v === String(saudeG[campo] ?? "").trim()) return;
    gravarSaude({ [campo]: v } as Partial<SaudePassageiro>, `saude.${pergunta}`);
  }

  function gravarMilhas(lista: ProgramaMilhas[]) {
    const limpa = lista.map((m) => ({ programa: m.programa.trim(), numero: m.numero.trim() })).filter((m) => m.programa || m.numero);
    const j = JSON.stringify(limpa);
    if (j === milhasG) return;
    void gravarPerfil({ milhas: limpa.length ? limpa : null }, "milhas").then((foi) => { if (foi) setMilhasG(j); });
  }

  // completude a partir do que está GRAVADO (não do que está sendo digitado)
  const comp = useMemo(() => {
    const cG = { nome: pGravado.nome ?? "", cpf: soDigitos(pGravado.cpf) || null, nascimento: pGravado.nascimento || null, telefone: soDigitos(pGravado.telefone) || null,
      email: pGravado.email || null, passaporte: pGravado.passaporte || null, passaporte_validade: pGravado.passaporte_validade || null };
    const pesG = pessoa ? { endereco_cep: pGravado.endereco_cep || null, endereco_rua: pGravado.endereco_rua || null, endereco_cidade: pGravado.endereco_cidade || null } : null;
    const perfG: PerfilViagem = {
      contato_emergencia_nome: pvGravado.contato_emergencia_nome || undefined, contato_emergencia_fone: pvGravado.contato_emergencia_fone || undefined,
      camiseta: pvGravado.camiseta || undefined, saude: saudeG,
    };
    return completudeProximaViagem(cG, pesG, perfilEfetivo(perfG, []), semFoto, voltaReferencia);
  }, [pGravado, pvGravado, saudeG, pessoa, semFoto, voltaReferencia]);

  function alternarSoFalta(ligar: boolean) {
    setSoFalta(ligar);
    // congela AGORA (a partir do gravado): o campo não some enquanto a pessoa digita
    setCongelado(ligar ? {
      chaves: new Set(comp.falta.map((f) => f.chave)),
      saude: new Set(PERGUNTAS_SAUDE.filter((q) => !temValor(saudeG[q.campo])).map((q) => q.campo as string)),
    } : null);
  }
  const mostra = (chave: string) => !soFalta || !!congelado?.chaves.has(chave);

  const inPessoa = (k: CampoPessoa, rotulo: string, extra: { tipo?: string; mascara?: (v: string) => string; dica?: ReactNode; auto?: string; chaveFalta?: string; modo?: "numeric" | "tel" | "email" } = {}) => {
    if (!mostra(extra.chaveFalta ?? k)) return null;
    const ehData = extra.tipo === "date";
    return (
      <Linha id={`tel-${k}`} rotulo={rotulo} estado={estado[k]} dica={<>
        {extra.dica}
        {ehData && (pGravado[k] ?? "") !== "" && <button type="button" className="fc-link fc-link--btn" onClick={() => limparData(k)}>Limpar</button>}
      </>}>
        <input id={`tel-${k}`} className="fc-input" type={extra.tipo ?? "text"} autoComplete={extra.auto ?? "off"} value={p[k] ?? ""}
          inputMode={extra.modo} max={ehData ? "2200-12-31" : undefined}
          onChange={(e) => setP((x) => ({ ...x, [k]: extra.mascara ? extra.mascara(e.target.value) : e.target.value }))}
          onBlur={() => (k === "endereco_cep" ? void sairCep() : sairPessoa(k))} />
      </Linha>
    );
  };

  const inPerfil = (k: ChaveTexto, rotulo: string, extra: { tipo?: string; mascara?: (v: string) => string; chaveFalta?: string; opcoes?: string[]; modo?: "numeric" | "tel" } = {}) => {
    if (!mostra(extra.chaveFalta ?? k)) return null;
    const daInscricao = pe0[k]?.origem === "inscricao" && gravadoNaFicha(k) === undefined && estado[k] !== "salvo"
      && normPerfil(k, pv[k]) === normPerfil(k, pe0[k]?.valor);
    return (
      <Linha id={`tel-${k}`} rotulo={rotulo} estado={estado[k]}
        dica={daInscricao ? <span className="fc-inline">da inscrição de {pe0[k]?.ida?.expedicao?.nome ?? "uma viagem"}
          <button type="button" className="fc-link fc-link--btn" disabled={!perfilAtivo} onClick={() => confirmar(k)}>Confirmar</button></span> : undefined}>
        {extra.opcoes ? (
          <select id={`tel-${k}`} className="fc-input" value={String(pv[k] ?? "")} disabled={!perfilAtivo}
            onChange={(e) => { const v = e.target.value; setPv((x) => ({ ...x, [k]: v })); void gravarCampoPerfil(k, v); }}>
            <option value="">—</option>
            {extra.opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input id={`tel-${k}`} className="fc-input" type={extra.tipo ?? "text"} value={String(pv[k] ?? "")} disabled={!perfilAtivo} inputMode={extra.modo}
            onChange={(e) => { const v = extra.mascara ? extra.mascara(e.target.value) : e.target.value; setPv((x) => ({ ...x, [k]: v })); }}
            onBlur={() => sairPerfil(k)} />
        )}
      </Linha>
    );
  };

  const inBool = (k: ChaveBool, rotulo: string) => !soFalta && (
    <Linha id={`tel-${k}`} rotulo={rotulo} estado={estado[k]}>
      <SN rotulo={rotulo} valor={pv[k]} disabled={!perfilAtivo}
        onEscolher={(v) => { const b = v === "" ? null : v === "Sim"; setPv((x) => ({ ...x, [k]: b ?? undefined })); void gravarCampoPerfil(k, b); }} />
    </Linha>
  );

  const fechar = () => onFechar(mudou);
  const rotuloFalta = (f: (typeof comp.falta)[number]) => (f.motivo ? `${f.rotulo} (${f.motivo.toLowerCase()})` : f.rotulo);

  return (
    <Modal aberto={aberto} titulo={`Preencher por telefone — ${c.nome.split(" ")[0]}`} onFechar={fechar} largura={820}
      rodape={<Btn variant="primary" onClick={fechar}>Pronto</Btn>}>
      <div className="fc-tel" ref={caixa} onKeyDown={enterProximo}>
        <div className="fc-tel__topo" role="status">
          <span className="fc-tel__pct">
            <strong className="qs-num">{comp.pctTelefone}% do que dá por telefone</strong>
            {comp.faltaTelefone.length > 0
              ? <span className="fc-bloco__s"> · falta: {comp.faltaTelefone.map(rotuloFalta).join(", ")}</span>
              : <span className="fc-bloco__s"> · tudo que dá pra perguntar está aqui</span>}
            {comp.pedirAoCliente.length > 0 && (
              <span className="fc-bloco__s" style={{ display: "block" }}>Pedir à cliente: {comp.pedirAoCliente.map((f) => f.rotulo).join(", ")} (ficha {comp.pct}% no total)</span>
            )}
          </span>
          <span className="fc-tel__barra" aria-hidden><span style={{ width: `${comp.pctTelefone}%` }} /></span>
          <label className="fc-inline fc-bloco__s">
            <input type="checkbox" checked={soFalta} onChange={(e) => alternarSoFalta(e.target.checked)} /> Só o que falta
          </label>
        </div>
        <p className="fc-bloco__s" style={{ margin: 0 }}>Cada campo salva sozinho quando você sai dele (Enter passa pro próximo). Tudo fica no histórico da ficha.</p>
        {aviso && <Aviso>{aviso}</Aviso>}
        {perfilErro && <Aviso tom="erro">O perfil de viagem não carregou ({perfilErro}). Emergência, camiseta, preferências e saúde ficam travados — feche e tente de novo.</Aviso>}
        {perfil === null && !perfilErro && <Aviso>Emergência, camiseta, preferências e saúde só gravam na ficha depois da migration 0228. Dados pessoais, documentos e endereço já gravam.</Aviso>}

        <fieldset className="fc-tel__grupo">
          <legend>Dados pessoais</legend>
          <div className="fc-tel__grade">
            {inPessoa("nome", "Nome completo")}
            {inPessoa("cpf", "CPF", { mascara: mascaraCpf, modo: "numeric" })}
            {inPessoa("nascimento", "Nascimento", { tipo: "date" })}
            {inPessoa("telefone", "Telefone (com DDD)", { mascara: mascaraTelefone, tipo: "tel", modo: "numeric" })}
            {inPessoa("email", "E-mail", { tipo: "email", modo: "email" })}
            {!soFalta && inPerfil("rg", "RG")}
            {!soFalta && inPerfil("sexo", "Sexo", { opcoes: SEXOS })}
            {!soFalta && inPerfil("nacionalidade", "Nacionalidade")}
          </div>
        </fieldset>

        <fieldset className="fc-tel__grupo">
          <legend>Passaporte</legend>
          <div className="fc-tel__grade">
            {inPessoa("passaporte", "Número do passaporte", { mascara: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) })}
            {inPessoa("passaporte_validade", "Validade", { tipo: "date", dica: "precisa valer 6 meses depois da volta" })}
            {!soFalta && inPerfil("nome_passaporte", "Nome exato do passaporte", { mascara: (v) => v.toUpperCase() })}
          </div>
          {semFoto === true && <p className="fc-bloco__s" style={{ margin: "6px 0 0" }}>Pedir à cliente: a foto do passaporte — pelo WhatsApp ou subindo na aba Documentos (não dá por telefone).</p>}
        </fieldset>

        {(mostra("endereco")) && (
          <fieldset className="fc-tel__grupo">
            <legend>Endereço</legend>
            <div className="fc-tel__grade">
              {inPessoa("endereco_cep", "CEP", { mascara: mascaraCep, dica: "preenche rua, bairro e cidade", chaveFalta: "endereco", modo: "numeric" })}
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
            {inPerfil("contato_emergencia_fone", "Emergência: telefone (exterior: comece com +)", { mascara: mascaraFoneEmergencia, tipo: "tel", chaveFalta: "emergencia", modo: "tel" })}
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
          {!soFalta && (
            <div className="fc-tel__campo" style={{ marginTop: 8 }}>
              <span className="fc-label">Programas de milhas <Status e={estado.milhas} /></span>
              {milhas.map((m, i) => (
                <span key={i} className="fc-inline" style={{ gap: 6 }}>
                  <input aria-label="Programa" placeholder="Programa (ex.: Smiles)" className="fc-input" value={m.programa} disabled={!perfilAtivo}
                    onChange={(e) => setMilhas((l) => l.map((x, j) => (j === i ? { ...x, programa: e.target.value } : x)))} onBlur={() => gravarMilhas(milhas)} />
                  <input aria-label="Número" placeholder="Número" className="fc-input" value={m.numero} disabled={!perfilAtivo} inputMode="numeric"
                    onChange={(e) => setMilhas((l) => l.map((x, j) => (j === i ? { ...x, numero: e.target.value } : x)))} onBlur={() => gravarMilhas(milhas)} />
                  <button type="button" className="fc-link fc-link--btn" disabled={!perfilAtivo}
                    onClick={() => { const l = milhas.filter((_, j) => j !== i); setMilhas(l); gravarMilhas(l); }}>Tirar</button>
                </span>
              ))}
              <span><button type="button" className="fc-link fc-link--btn" disabled={!perfilAtivo}
                onClick={() => setMilhas((l) => [...l, { programa: "", numero: "" }])}>+ Programa de milhas</button></span>
            </div>
          )}
        </fieldset>

        {mostra("saude") && (
          <fieldset className="fc-tel__grupo">
            <legend>Saúde {pe0.saude.origem === "inscricao" && <StatusChip>da inscrição de {pe0.saude.ida?.expedicao?.nome ?? "uma viagem"}</StatusChip>}</legend>
            <div className="fc-tel__saude">
              {PERGUNTAS_SAUDE.map((q) => {
                // congelado: a pergunta que faltava continua na tela depois de respondida (e o "Qual?" aparece)
                if (soFalta && !congelado?.saude.has(q.campo as string)) return null;
                const val = String(saude[q.campo] ?? "");
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
                        value={String(saude[q.detalheCampo] ?? "")}
                        onChange={(e) => { const v = e.target.value; setSaude((x) => ({ ...x, [q.detalheCampo!]: v })); }}
                        onBlur={() => sairDetalheSaude(q.detalheCampo!, q.campo)} />
                    )}
                    {val === "Sim" && q.detalhe2Campo && (
                      <input aria-label={q.detalhe2Pergunta ?? "Detalhe"} placeholder={q.detalhe2Pergunta} className="fc-input" disabled={!perfilAtivo}
                        value={String(saude[q.detalhe2Campo] ?? "")}
                        onChange={(e) => { const v = e.target.value; setSaude((x) => ({ ...x, [q.detalhe2Campo!]: v })); }}
                        onBlur={() => sairDetalheSaude(q.detalhe2Campo!, q.campo)} />
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

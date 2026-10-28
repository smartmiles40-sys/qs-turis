// src/clientes/cadastro/CadastroPessoa.tsx
// -----------------------------------------------------------------------------
// O CADASTRO DA PESSOA, igual em todo setor (0213). Um formulário curto: nome,
// nascimento, CPF, passaporte + validade, e-mail, telefone, endereço (CEP preenche
// o resto) e QUEM VIAJA JUNTO — cada acompanhante é uma ficha própria (procura por
// CPF/telefone antes de criar, pra não duplicar).
//
// Salva num botão só (grava apenas o que mudou) e mostra o que falta. Quem edita por
// último vale; o banco leva pros passageiros das expedições e guarda no histórico
// quem mudou o quê. Usado por: SDR (ficha do lead), Closer (cartão), Rel e Ops (ficha).
//
//   <CadastroPessoa clienteId="…" />                       tudo
//   <CadastroPessoa clienteId="…" secoes={["endereco", "acompanhantes"]} />
//   <CadastroPessoa clienteId="…" dataViagem="2027-03-10" />  avisa passaporte
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta } from "@/rel/ui";
import {
  CadastroInativo, VINCULOS, avisoPassaporte, buscarCep, buscarOuCriarPessoa, cpfValido, desligarAcompanhante, lerPessoa,
  ligarAcompanhante, mascaraCep, mascaraCpf, mascaraTelefone, oQueFalta, salvarPessoa, soDigitos,
  type Acompanhante, type CampoPessoa, type CamposPessoa, type Pessoa, type Vinculo,
} from "./api";

export type SecaoCadastro = "dados" | "endereco" | "acompanhantes";

export interface CadastroPessoaProps {
  clienteId: string;
  /** Quais partes mostrar (padrão: todas). */
  secoes?: SecaoCadastro[];
  /** Data de embarque, quando houver: o aviso do passaporte passa a ser "6 meses depois da viagem". */
  dataViagem?: string | null;
  /** Força só leitura (o banco também diz se pode editar). */
  somenteLeitura?: boolean;
  /** Salvou algo (dados ou acompanhantes). */
  onMudou?: (p: Pessoa) => void;
  /** Sem a moldura/título (ex.: cadastro do acompanhante aberto dentro de outro). */
  embutido?: boolean;
}

// As cores da área do Relacionamento + o .rel-input, presos a este pedaço — o
// componente também aparece no Comercial, onde o REL_CSS não está carregado.
const CSS = `
.cadp { --rel: #0E7C6A; --rel-hover: #0B6B5C; --rel-ink: #0B6B5C; --rel-soft: #E4F4EF; }
html.dark .cadp { --rel-ink: #3CCFB3; --rel-soft: rgba(43, 192, 166, .14); }
.cadp .rel-input { width: 100%; padding: 8px 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font-size: 14px; }
.cadp .rel-input::placeholder { color: var(--ink3); }
.cadp .rel-input:focus, .cadp .rel-input:focus-visible { outline: none; border-color: var(--rel); box-shadow: 0 0 0 3px rgba(14, 124, 106, .25); }
.cadp .rel-input[aria-invalid="true"] { border-color: var(--red); }
.cadp .rel-input:disabled { opacity: .75; cursor: default; }
.cadp-sec { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 12px; }
.cadp-sec:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
.cadp-t { font-size: 12px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--ink3); margin-bottom: 8px; }
`;

type Form = Record<CampoPessoa, string>;
const CAMPOS: CampoPessoa[] = [
  "nome", "nascimento", "cpf", "passaporte", "passaporte_validade", "email", "telefone",
  "endereco_cep", "endereco_rua", "endereco_numero", "endereco_complemento", "endereco_bairro", "endereco_cidade", "endereco_estado",
];

function formDe(p: Pessoa): Form {
  const f = Object.fromEntries(CAMPOS.map((k) => [k, (p[k as keyof Pessoa] as string | null) ?? ""])) as Form;
  f.cpf = f.cpf ? mascaraCpf(f.cpf) : "";
  f.telefone = f.telefone ? mascaraTelefone(f.telefone) : "";
  f.endereco_cep = f.endereco_cep ? mascaraCep(f.endereco_cep) : "";
  f.nascimento = f.nascimento.slice(0, 10);
  f.passaporte_validade = f.passaporte_validade.slice(0, 10);
  return f;
}

/** Erros de digitação, campo a campo (as mesmas regras que o banco confere). */
function validar(f: Form): Partial<Record<CampoPessoa, string>> {
  const e: Partial<Record<CampoPessoa, string>> = {};
  if (f.nome.trim().length < 2) e.nome = "Informe o nome completo.";
  if (f.cpf && !cpfValido(f.cpf)) e.cpf = "CPF inválido — confira os números.";
  if (f.passaporte && !/^[A-Za-z0-9]{5,12}$/.test(f.passaporte.replace(/[^A-Za-z0-9]/g, ""))) e.passaporte = "5 a 12 letras e números.";
  if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "E-mail inválido.";
  const d = soDigitos(f.telefone);
  if (f.telefone && (d.length < 10 || d.length > 13)) e.telefone = "Use DDD + número.";
  if (f.endereco_cep && soDigitos(f.endereco_cep).length !== 8) e.endereco_cep = "CEP tem 8 números.";
  return e;
}

export default function CadastroPessoa({ clienteId, secoes, dataViagem, somenteLeitura, onMudou, embutido }: CadastroPessoaProps) {
  const mostrar = useMemo(() => new Set<SecaoCadastro>(secoes ?? ["dados", "endereco", "acompanhantes"]), [secoes]);
  const [p, setP] = useState<Pessoa | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "inativo" | "erro">("carregando");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: "ok" | "erro" | "aviso"; t: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [tentouSalvar, setTentouSalvar] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const x = await lerPessoa(clienteId);
      if (!x) { setEstado("erro"); setErro("Ficha não encontrada."); return; }
      setP(x); setF(formDe(x)); setEstado("ok");
    } catch (e) {
      if (e instanceof CadastroInativo) { setEstado("inativo"); return; }
      setEstado("erro"); setErro(e instanceof Error ? e.message : "Não consegui abrir o cadastro.");
    }
  }, [clienteId]);
  useEffect(() => { setEstado("carregando"); void carregar(); }, [carregar]);

  const aplicar = (x: Pessoa) => { setP(x); setF(formDe(x)); onMudou?.(x); };

  // CEP completo → busca rua/bairro/cidade/UF (uma vez por CEP)
  const ultimoCep = useRef("");
  useEffect(() => {
    const cep = soDigitos(f?.endereco_cep);
    if (!f || cep.length !== 8 || cep === ultimoCep.current) return;
    if (p && soDigitos(p.endereco_cep) === cep && ultimoCep.current === "") { ultimoCep.current = cep; return; }
    ultimoCep.current = cep;
    let vivo = true;
    void buscarCep(cep).then((r) => {
      if (!vivo || !r) return;
      setF((atual) => atual && ({
        ...atual,
        endereco_rua: r.rua || atual.endereco_rua, endereco_bairro: r.bairro || atual.endereco_bairro,
        endereco_cidade: r.cidade || atual.endereco_cidade, endereco_estado: r.estado || atual.endereco_estado,
      }));
    });
    return () => { vivo = false; };
  }, [f?.endereco_cep]); // eslint-disable-line react-hooks/exhaustive-deps

  if (estado === "carregando") return <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Carregando o cadastro…</p>;
  if (estado === "inativo") return <Aviso>Cadastro único ainda não ativado no banco (migration 0213). Por enquanto, use a ficha do lead.</Aviso>;
  if (estado === "erro" || !p || !f) return <Aviso tom="erro">{erro ?? "Não consegui abrir o cadastro."}</Aviso>;

  const leitura = somenteLeitura || !p.pode_editar;
  const inicial = formDe(p);
  const mudou = CAMPOS.filter((k) => f[k].trim() !== inicial[k].trim());
  const erros = validar(f);
  const errosVisiveis = (k: CampoPessoa) => (tentouSalvar || (f[k] && f[k] !== inicial[k]) ? erros[k] : undefined);
  const falta = oQueFalta(p, { endereco: mostrar.has("endereco") }).filter((r) => mostrar.has("dados") || r === "endereço");
  const avisoPass = avisoPassaporte(f.passaporte_validade, dataViagem);
  const set = (k: CampoPessoa) => (e: ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (k === "cpf") v = mascaraCpf(v);
    if (k === "telefone") v = mascaraTelefone(v);
    if (k === "endereco_cep") v = mascaraCep(v);
    if (k === "endereco_estado") v = v.toUpperCase().slice(0, 2);
    if (k === "passaporte") v = v.toUpperCase();
    setF({ ...f, [k]: v });
  };
  const ent = (k: CampoPessoa, extra: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Entrada value={f[k]} onChange={set(k)} disabled={leitura || salvando} aria-invalid={!!errosVisiveis(k)} {...extra} />
  );

  async function salvar() {
    setTentouSalvar(true); setAviso(null);
    const relevantes = mudou.filter((k) => erros[k]);
    if (relevantes.length) { setAviso({ tom: "erro", t: "Confira os campos marcados em vermelho." }); return; }
    if (!mudou.length) return;
    const campos: CamposPessoa = Object.fromEntries(mudou.map((k) => [k, k === "telefone" || k === "cpf" ? soDigitos(f![k]) : f![k]]));
    setSalvando(true);
    try {
      aplicar(await salvarPessoa(clienteId, campos));
      setTentouSalvar(false);
      setAviso({ tom: "ok", t: "Cadastro salvo. Vale pra todos os setores e pras viagens da pessoa." });
    } catch (e) {
      setAviso({ tom: "erro", t: e instanceof Error ? e.message : "Não consegui salvar." });
    } finally { setSalvando(false); }
  }

  const corpo = (
    <div className="cadp space-y-3">
      <style>{CSS}</style>
      {p.mesclado_de && <Aviso>Esta ficha era repetida e foi juntada — você está vendo a que ficou.</Aviso>}

      {!embutido && (
        <div className="flex flex-wrap items-center gap-1.5">
          {falta.length === 0
            ? <Etiqueta tom="rel">Cadastro completo</Etiqueta>
            : <><span className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Falta:</span>{falta.map((x) => <Etiqueta key={x} tom="aviso">{x}</Etiqueta>)}</>}
          {leitura && <Etiqueta>só leitura</Etiqueta>}
        </div>
      )}

      {mostrar.has("dados") && (
        <div className="cadp-sec">
          {!embutido && <p className="cadp-t">Dados</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><Campo rotulo="Nome completo (como no passaporte)" erro={errosVisiveis("nome")}>{ent("nome", { autoComplete: "off" })}</Campo></div>
            <Campo rotulo="Data de nascimento">{ent("nascimento", { type: "date" })}</Campo>
            <Campo rotulo="CPF" erro={errosVisiveis("cpf")}>{ent("cpf", { inputMode: "numeric", placeholder: "000.000.000-00" })}</Campo>
            <Campo rotulo="Passaporte" erro={errosVisiveis("passaporte")}>{ent("passaporte", { placeholder: "AB123456" })}</Campo>
            <Campo rotulo="Validade do passaporte" erro={avisoPass?.tom === "erro" ? avisoPass.texto : undefined} dica={avisoPass?.tom === "aviso" ? <span style={{ color: "var(--warn-ink)" }}>{avisoPass.texto}</span> : undefined}>
              {ent("passaporte_validade", { type: "date" })}
            </Campo>
            <Campo rotulo="E-mail" erro={errosVisiveis("email")}>{ent("email", { type: "email", placeholder: "nome@exemplo.com" })}</Campo>
            <Campo rotulo="Telefone / WhatsApp" erro={errosVisiveis("telefone")}>{ent("telefone", { inputMode: "tel", placeholder: "(11) 98888-7777" })}</Campo>
          </div>
        </div>
      )}

      {mostrar.has("endereco") && (
        <div className="cadp-sec">
          <p className="cadp-t">Endereço</p>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <div className="col-span-1 sm:col-span-2"><Campo rotulo="CEP" erro={errosVisiveis("endereco_cep")} dica={leitura ? undefined : "Preenche a rua sozinho"}>{ent("endereco_cep", { inputMode: "numeric", placeholder: "00000-000" })}</Campo></div>
            <div className="col-span-2 sm:col-span-4"><Campo rotulo="Rua">{ent("endereco_rua")}</Campo></div>
            <div className="col-span-1 sm:col-span-2"><Campo rotulo="Número">{ent("endereco_numero")}</Campo></div>
            <div className="col-span-1 sm:col-span-4"><Campo rotulo="Complemento">{ent("endereco_complemento", { placeholder: "apto, bloco…" })}</Campo></div>
            <div className="col-span-2 sm:col-span-2"><Campo rotulo="Bairro">{ent("endereco_bairro")}</Campo></div>
            <div className="col-span-1 sm:col-span-3"><Campo rotulo="Cidade">{ent("endereco_cidade")}</Campo></div>
            <div className="col-span-1 sm:col-span-1"><Campo rotulo="UF">{ent("endereco_estado", { maxLength: 2 })}</Campo></div>
          </div>
        </div>
      )}

      {!leitura && (mostrar.has("dados") || mostrar.has("endereco")) && (
        <div className="flex flex-wrap items-center gap-2">
          <Botao variante="primario" onClick={() => void salvar()} disabled={salvando || mudou.length === 0}>
            {salvando ? "Salvando…" : mudou.length ? `Salvar (${mudou.length})` : "Salvo"}
          </Botao>
          {mudou.length > 0 && !salvando && <Botao variante="fantasma" onClick={() => { setF(inicial); setTentouSalvar(false); setAviso(null); }}>Desfazer</Botao>}
        </div>
      )}
      {aviso && <Aviso tom={aviso.tom}>{aviso.t}</Aviso>}

      {mostrar.has("acompanhantes") && (
        <div className="cadp-sec">
          <p className="cadp-t">Quem viaja junto</p>
          <Acompanhantes pessoa={p} leitura={leitura} dataViagem={dataViagem} onMudou={aplicar} />
        </div>
      )}
    </div>
  );
  return corpo;
}

// ── Acompanhantes ───────────────────────────────────────────────────────────
function Acompanhantes({ pessoa, leitura, dataViagem, onMudou }: { pessoa: Pessoa; leitura: boolean; dataViagem?: string | null; onMudou: (p: Pessoa) => void }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function tirar(a: Acompanhante) {
    if (!window.confirm(`Tirar ${a.nome} de quem viaja junto? A ficha dela continua existindo.`)) return;
    setOcupado(a.id); setErro(null);
    try { onMudou(await desligarAcompanhante(pessoa.id, a.id)); } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui tirar."); }
    finally { setOcupado(null); }
  }
  async function trocarVinculo(a: Acompanhante, v: Vinculo) {
    setOcupado(a.id); setErro(null);
    try { onMudou(await ligarAcompanhante(pessoa.id, a.id, v)); } catch (e) { setErro(e instanceof Error ? e.message : "Não consegui mudar."); }
    finally { setOcupado(null); }
  }

  return (
    <div className="space-y-2">
      {pessoa.acompanhantes.length === 0 && !novo && (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Ninguém ainda. Cônjuge, filhos, amigos que vão junto entram aqui — cada um com o próprio cadastro.</p>
      )}
      {pessoa.acompanhantes.map((a) => {
        const falta = oQueFalta(a, { endereco: false });
        return (
          <div key={a.id} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-semibold flex-1 min-w-[140px]" style={{ color: "var(--ink)" }}>{a.nome}</span>
              {leitura ? <Etiqueta tom="rel">{VINCULOS[a.vinculo] ?? "Outro"}</Etiqueta> : (
                <select className="rel-input" style={{ width: "auto", padding: "4px 8px", fontSize: 12.5 }} value={a.vinculo} disabled={ocupado === a.id}
                  aria-label={`Vínculo de ${a.nome}`} onChange={(e) => void trocarVinculo(a, e.target.value as Vinculo)}>
                  {(Object.keys(VINCULOS) as Vinculo[]).map((v) => <option key={v} value={v}>{VINCULOS[v]}</option>)}
                </select>
              )}
              <Botao variante="fantasma" onClick={() => setAberto(aberto === a.id ? null : a.id)} aria-expanded={aberto === a.id}>
                {aberto === a.id ? "Fechar" : leitura ? "Ver dados" : "Preencher dados"}
              </Botao>
              {!leitura && <Botao variante="fantasma" onClick={() => void tirar(a)} disabled={ocupado === a.id}>Tirar</Botao>}
            </div>
            {falta.length > 0 && aberto !== a.id && (
              <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>Falta: {falta.join(", ")}</p>
            )}
            {aberto === a.id && (
              <div className="mt-2">
                <CadastroPessoa clienteId={a.id} secoes={["dados"]} embutido somenteLeitura={leitura} dataViagem={dataViagem}
                  onMudou={() => void lerPessoaDeNovo(pessoa.id, onMudou)} />
              </div>
            )}
          </div>
        );
      })}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!leitura && (novo
        ? <NovoAcompanhante pessoa={pessoa} onPronto={(x) => { setNovo(false); if (x) onMudou(x); }} />
        : <Botao variante="secundario" onClick={() => setNovo(true)}>+ Adicionar quem viaja junto</Botao>)}
    </div>
  );
}

async function lerPessoaDeNovo(id: string, onMudou: (p: Pessoa) => void) {
  try { const x = await lerPessoa(id); if (x) onMudou(x); } catch { /* a lista só fica um pouco atrasada */ }
}

/** Mini-formulário: procura a pessoa (CPF → telefone) antes de criar outra ficha. */
function NovoAcompanhante({ pessoa, onPronto }: { pessoa: Pessoa; onPronto: (p: Pessoa | null) => void }) {
  const [nome, setNome] = useState("");
  const [vinculo, setVinculo] = useState<Vinculo>("conjuge");
  const [cpf, setCpf] = useState("");
  const [nascimento, setNascimento] = useState("");
  const [telefone, setTelefone] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function adicionar() {
    setErro(null);
    if (nome.trim().length < 2) { setErro("Informe o nome completo."); return; }
    if (cpf && !cpfValido(cpf)) { setErro("CPF inválido — confira os números."); return; }
    setOcupado(true);
    try {
      const achada = await buscarOuCriarPessoa({ cpf: soDigitos(cpf) || null, telefone: soDigitos(telefone) || null, nome: nome.trim() });
      if (!achada) throw new Error("Não consegui criar a ficha.");
      if (achada.id === pessoa.id) throw new Error("Esses dados são da própria pessoa — confira o CPF/telefone.");
      let x = await ligarAcompanhante(pessoa.id, achada.id, vinculo);
      // ficha nova: já grava o que foi digitado aqui (nascimento etc.)
      if (achada.criado && nascimento) await salvarPessoa(achada.id, { nascimento }).then(async () => { x = (await lerPessoa(pessoa.id)) ?? x; });
      if (!achada.criado) window.alert(`Já existia a ficha de ${achada.nome} (${achada.motivo ?? "mesmos dados"}) — liguei essa, sem criar outra.`);
      onPronto(x);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui adicionar.");
    } finally { setOcupado(false); }
  }

  return (
    <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Campo rotulo="Nome completo"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} autoFocus disabled={ocupado} /></Campo></div>
        <Campo rotulo={`É o quê de ${pessoa.nome.split(" ")[0]}?`}>
          <select className="rel-input" value={vinculo} onChange={(e) => setVinculo(e.target.value as Vinculo)} disabled={ocupado}>
            {(Object.keys(VINCULOS) as Vinculo[]).map((v) => <option key={v} value={v}>{VINCULOS[v]}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Data de nascimento"><Entrada type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} disabled={ocupado} /></Campo>
        <Campo rotulo="CPF" dica="Se tiver: acha a ficha se ela já existir">
          <Entrada inputMode="numeric" value={cpf} onChange={(e) => setCpf(mascaraCpf(e.target.value))} placeholder="000.000.000-00" disabled={ocupado} />
        </Campo>
        <Campo rotulo="Telefone (se for outro)"><Entrada inputMode="tel" value={telefone} onChange={(e) => setTelefone(mascaraTelefone(e.target.value))} disabled={ocupado} /></Campo>
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" onClick={() => void adicionar()} disabled={ocupado}>{ocupado ? "Procurando…" : "Adicionar"}</Botao>
        <Botao variante="fantasma" onClick={() => onPronto(null)} disabled={ocupado}>Cancelar</Botao>
      </div>
      <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Passaporte e o resto você completa depois, em "Preencher dados".</p>
    </div>
  );
}

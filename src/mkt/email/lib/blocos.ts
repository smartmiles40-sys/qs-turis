// src/mkt/email/lib/blocos.ts
// -----------------------------------------------------------------------------
// Editor por blocos → HTML compatível com e-mail (0245).
// Puro e sem React: a tela usa pra pré-visualizar e pra gravar `html` junto com
// `blocos` (o servidor só personaliza, rastreia e troca {{descadastro}}).
//
// Regras de e-mail (Gmail/Outlook/Apple Mail):
//   • layout em <table>, largura 600, estilos INLINE (Gmail corta <style> em
//     vários casos), fontes de sistema;
//   • imagem com largura explícita, display:block e alt;
//   • botão "à prova de bala": <a> com padding dentro de <td> com fundo;
//   • colunas viram empilháveis no celular só por largura percentual (sem media query).
// Tudo que vem do usuário é escapado; link só http(s)/mailto/tel/{{variavel}};
// imagem só https.
// Testado em tests/mkt-email/blocos.test.ts.
// -----------------------------------------------------------------------------

export type Alinhamento = "esquerda" | "centro" | "direita";

export type Bloco =
  | { id: string; tipo: "titulo"; texto: string; nivel?: 1 | 2; alinhar?: Alinhamento }
  | { id: string; tipo: "texto"; texto: string; alinhar?: Alinhamento }
  | { id: string; tipo: "imagem"; url: string; alt?: string; link?: string; largura?: number }
  | { id: string; tipo: "botao"; texto: string; url: string; cor?: string; alinhar?: Alinhamento }
  | { id: string; tipo: "divisor" }
  | { id: string; tipo: "espaco"; altura?: number }
  | { id: string; tipo: "colunas"; esquerda: Coluna; direita: Coluna }
  | { id: string; tipo: "rodape"; texto?: string };

export interface Coluna { imagem?: string; texto?: string }

export interface OpcoesRender {
  /** Dados da empresa no rodapé (CNPJ, endereço) — vêm de mkt_email_config. */
  rodapeTexto?: string | null;
  rodapeEndereco?: string | null;
  corFundo?: string;
  corDestaque?: string;
}

export const COR_PADRAO = "#0E7C6A";
const FONTE = "Arial, Helvetica, sans-serif";
const TINTA = "#1F2937";

export function escapar(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Link aceito no e-mail; o resto vira "#" (nada de javascript:, data:…). */
export function linkSeguro(url: unknown): string {
  const u = String(url ?? "").trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u)) return u;
  if (/^(mailto|tel):[^\s"'<>]+$/i.test(u)) return u;
  if (/^\{\{\s*[\w.-]+\s*\}\}$/.test(u)) return u;
  return "#";
}

/** Imagem só por https (http dá "conteúdo misto" e o Gmail bloqueia). */
export function imagemSegura(url: unknown): string | null {
  const u = String(url ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

export function corSegura(c: unknown, padrao = COR_PADRAO): string {
  const s = String(c ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : padrao;
}

const ALINHAR: Record<Alinhamento, string> = { esquerda: "left", centro: "center", direita: "right" };
const alinhar = (a?: Alinhamento) => ALINHAR[a ?? "esquerda"] ?? "left";

/**
 * Texto simples com 3 marcações: **negrito**, [texto](url) e quebra de linha.
 * Escapa primeiro, marca depois — o usuário nunca injeta HTML.
 */
export function textoRico(texto: string, cor: string): string {
  let s = escapar(texto);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, url: string) => {
    // url já passou pelo escapar; desfaz o &amp; só pra conferir e escapa de novo.
    const seguro = linkSeguro(url.replace(/&amp;/g, "&"));
    return `<a href="${escapar(seguro)}" style="color:${cor};text-decoration:underline;">${t}</a>`;
  });
  return s.replace(/\r?\n/g, "<br>");
}

const linha = (conteudo: string, padding = "0 32px 16px") =>
  `<tr><td style="padding:${padding};font-family:${FONTE};color:${TINTA};">${conteudo}</td></tr>`;

function renderColuna(c: Coluna, cor: string): string {
  const img = imagemSegura(c.imagem);
  return [
    img ? `<img src="${escapar(img)}" width="260" alt="" style="display:block;width:100%;max-width:260px;height:auto;border:0;border-radius:8px;margin:0 0 10px;">` : "",
    c.texto ? `<div style="font-size:15px;line-height:1.6;">${textoRico(c.texto, cor)}</div>` : "",
  ].join("");
}

export function renderBloco(b: Bloco, o: OpcoesRender = {}): string {
  const cor = corSegura(o.corDestaque);
  switch (b.tipo) {
    case "titulo": {
      const tam = b.nivel === 2 ? 20 : 26;
      return linha(`<h${b.nivel === 2 ? 2 : 1} style="margin:0;font-size:${tam}px;line-height:1.3;font-weight:bold;text-align:${alinhar(b.alinhar)};">${escapar(b.texto)}</h${b.nivel === 2 ? 2 : 1}>`);
    }
    case "texto":
      return linha(`<div style="font-size:16px;line-height:1.6;text-align:${alinhar(b.alinhar)};">${textoRico(b.texto, cor)}</div>`);
    case "imagem": {
      const src = imagemSegura(b.url);
      if (!src) return "";
      const w = Math.max(40, Math.min(536, Math.round(Number(b.largura) || 536)));
      const img = `<img src="${escapar(src)}" width="${w}" alt="${escapar(b.alt ?? "")}" style="display:block;margin:0 auto;width:100%;max-width:${w}px;height:auto;border:0;">`;
      const link = b.link ? linkSeguro(b.link) : "#";
      return linha(link !== "#" ? `<a href="${escapar(link)}" target="_blank">${img}</a>` : img);
    }
    case "botao": {
      const fundo = corSegura(b.cor, cor);
      const url = escapar(linkSeguro(b.url));
      return linha(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${alinhar(b.alinhar)}" style="margin:${b.alinhar === "centro" ? "0 auto" : "0"};"><tr>` +
        `<td style="background:${fundo};border-radius:8px;" bgcolor="${fundo}">` +
        `<a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONTE};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;">${escapar(b.texto)}</a>` +
        `</td></tr></table>`,
        "4px 32px 20px",
      );
    }
    case "divisor":
      return linha(`<div style="border-top:1px solid #E5E7EB;font-size:0;line-height:0;">&nbsp;</div>`, "8px 32px 16px");
    case "espaco": {
      const h = Math.max(4, Math.min(120, Math.round(Number(b.altura) || 24)));
      return `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    }
    case "colunas":
      return linha(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td width="50%" valign="top" style="padding-right:8px;font-family:${FONTE};color:${TINTA};">${renderColuna(b.esquerda ?? {}, cor)}</td>` +
        `<td width="50%" valign="top" style="padding-left:8px;font-family:${FONTE};color:${TINTA};">${renderColuna(b.direita ?? {}, cor)}</td>` +
        `</tr></table>`,
      );
    case "rodape": {
      const partes = [
        b.texto ? escapar(b.texto) : o.rodapeTexto ? escapar(o.rodapeTexto) : "",
        o.rodapeEndereco ? escapar(o.rodapeEndereco) : "",
        // {{descadastro}} é trocado no servidor pelo link de UMA pessoa (POST de confirmação).
        `<a href="{{descadastro}}" style="color:#6B7280;text-decoration:underline;">Descadastrar meu e-mail</a>`,
      ].filter(Boolean);
      return `<tr><td style="padding:24px 32px 32px;font-family:${FONTE};font-size:12px;line-height:1.6;color:#6B7280;text-align:center;border-top:1px solid #F0F0F0;">${partes.join("<br>")}</td></tr>`;
    }
    default:
      return "";
  }
}

/** Documento completo. Sem bloco de rodapé, acrescenta um (descadastro é obrigatório). */
export function renderEmail(blocos: Bloco[], o: OpcoesRender = {}): string {
  const lista = Array.isArray(blocos) ? blocos : [];
  const comRodape = lista.some((b) => b.tipo === "rodape") ? lista : [...lista, { id: "rodape-auto", tipo: "rodape" } as Bloco];
  const fundo = corSegura(o.corFundo, "#F3F4F6");
  const corpo = comRodape.map((b) => renderBloco(b, o)).join("\n");
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title></title></head>
<body style="margin:0;padding:0;background:${fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${fundo};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;">
<tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>
${corpo}
</table>
</td></tr></table>
</body></html>`;
}

let seq = 0;
export function novoId(): string {
  seq += 1;
  return `b${Date.now().toString(36)}${seq}`;
}

export function blocoNovo(tipo: Bloco["tipo"]): Bloco {
  const id = novoId();
  switch (tipo) {
    case "titulo": return { id, tipo, texto: "Título", nivel: 1, alinhar: "esquerda" };
    case "texto": return { id, tipo, texto: "Olá, {{primeiro_nome}}!\nEscreva aqui." };
    case "imagem": return { id, tipo, url: "", alt: "" };
    case "botao": return { id, tipo, texto: "Quero saber mais", url: "https://", alinhar: "centro" };
    case "divisor": return { id, tipo };
    case "espaco": return { id, tipo, altura: 24 };
    case "colunas": return { id, tipo, esquerda: { texto: "Coluna 1" }, direita: { texto: "Coluna 2" } };
    case "rodape": return { id, tipo };
  }
}

export const MODELO_INICIAL = (): Bloco[] => [
  blocoNovo("titulo"),
  blocoNovo("texto"),
  blocoNovo("botao"),
  blocoNovo("rodape"),
];

export const ROTULO_BLOCO: Record<Bloco["tipo"], string> = {
  titulo: "Título", texto: "Texto", imagem: "Imagem", botao: "Botão", divisor: "Divisor",
  espaco: "Espaço", colunas: "2 colunas", rodape: "Rodapé (descadastro)",
};

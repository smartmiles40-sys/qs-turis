// api/whatsapp.js
// -----------------------------------------------------------------------------
// O LINK "FALAR NO WHATSAPP" DAS PÁGINAS — agora é um FORMULÁRIO.
//
// 29/09/2026, manhã: nasceu redirecionando pro WhatsApp do SDR da vez (o 1935
// saiu das páginas). 29/09/2026, tarde (Bruno): "estamos tendo muitos problemas
// com separação de lead dos SDRs, então para acabar com o problema, vamos
// deixar tudo com as automações do QS de distribuição".
//
// Então esta rota não abre mais o WhatsApp de ninguém. Ela devolve uma página
// com o formulário curto (o mesmo do distribuidor.js): nome, WhatsApp, e-mail
// → /api/lead-site → o lead entra no QS e a distribuição do QS escolhe o dono.
// É o que a pessoa vê quando o distribuidor.js não carregou, abriu o link em
// nova aba, ou veio de uma página antiga em cache.
//
//   GET /api/whatsapp?d=<destino>&c=<Orgânico|Tráfego>
//   (sem d/c, o destino é deduzido do Referer)
// -----------------------------------------------------------------------------

function texto(v, max) {
  if (v == null) return '';
  // eslint-disable-next-line no-control-regex
  return String(Array.isArray(v) ? v[0] : v).replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, max);
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  // Vai pro HTML como JSON (JSON.stringify escapa aspas); `<` vira < pra
  // ninguém fechar a tag <script> pelo parâmetro da URL.
  const opts = {};
  const d = texto(req.query?.d, 60);
  const c = texto(req.query?.c, 20);
  if (d) opts.destino = d;
  if (c) opts.canal = c;
  const ref = texto(req.headers.referer, 300);
  const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Fale com nosso time · Se Tu For, Eu Vou! Viagens</title>
<style>body{margin:0;min-height:100vh;background:#F8F6F7}</style>
</head>
<body>
<script src="/distribuidor.js"></script>
<script>
  (function () {
    var opts = ${json(opts)};
    var ref = ${json(ref)};
    // Veio de uma página nossa sem d/c: o destino sai do endereço dela.
    if (ref && !opts.destino) {
      try { opts.origemUrl = new URL(ref).href; } catch (e) {}
    }
    opts.fixo = true;
    window.stfvAbrirFormulario(opts);
  })();
</script>
</body>
</html>`);
}

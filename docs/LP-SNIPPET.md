# Como a landing page chama o rodízio

> **Este arquivo é só referência.** As LPs vivem no repositório `setur-unificado`,
> que não foi tocado. Copie o trecho abaixo pra lá quando for a hora.

---

## O que muda no formulário

Hoje o envio faz uma coisa: manda o lead pro `/api/save-lead` (que dispara o n8n →
Bitrix + QS). Passa a fazer **duas, nesta ordem**:

```
1. POST https://qs-turis.vercel.app/api/lead   → devolve { numero, sdr_nome }
2. POST /api/save-lead                          → o caminho de sempre, sem mudança
3. redireciona pro wa.me do número recebido
```

### A ordem não é detalhe

O passo 1 vem **antes** e é `await`. Ele grava o bilhete `telefone → SDR` no banco.
Quando o n8n (que só começa no passo 2) criar o lead no QS, o trigger procura esse
bilhete e grava o mesmo SDR como dono do card — é isso que faz o Bitrix receber o
responsável certo.

Se o passo 2 corresse na frente, o lead nasceria antes do bilhete existir e cairia no
rodízio global — a pessoa conversaria com a Mariana e o card seria do Victor. Na prática
o passo 1 é sempre mais rápido (uma chamada, contra webhook → n8n → HTTP), mas manter a
ordem explícita é o que garante.

---

## O campo escondido

O formulário precisa de um input chamado `site`, invisível pra gente e visível pra robô:

```html
<!-- CAMPO-ARMADILHA. Não remova e não mostre. Robô de formulário preenche tudo
     que encontra; gente nunca preenche isto. O servidor descarta o envio sem
     girar o rodízio. -->
<input type="text" name="site" tabindex="-1" autocomplete="off"
       aria-hidden="true"
       style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" />
```

---

## O trecho (JavaScript puro)

```js
const QS_LEAD_URL = "https://qs-turis.vercel.app/api/lead";

/**
 * Descobre com qual SDR esta pessoa vai falar.
 * Devolve { numero, sdr_nome } ou null se não deu — nunca lança.
 */
async function descobrirWhatsapp(dados) {
  // 4s é o teto: acima disso a pessoa está olhando um botão girando. Melhor
  // mandar pra página de obrigado do que segurar ela na tela.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(QS_LEAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.numero ? json : null;
  } catch {
    return null;                    // rede caiu, CORS, timeout: segue o baile
  } finally {
    clearTimeout(timer);
  }
}

async function aoEnviarFormulario(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const botao = form.querySelector("[type=submit]");

  botao.disabled = true;
  botao.textContent = "Enviando…";

  const dados = {
    nome:      form.nome.value.trim(),
    telefone:  form.telefone.value,        // pode vir com máscara: o servidor limpa
    email:     form.email.value.trim(),
    origem:    "lp-japao",                 // troque por LP
    expedicao: "Japão — Outubro/2027",     // vira o campo "segmento" no QS
    site:      form.site.value,            // o campo-armadilha
  };

  // 1) QUEM VAI ATENDER — precisa vir antes do passo 2.
  const destino = await descobrirWhatsapp(dados);

  // 2) O CAMINHO DE SEMPRE (n8n → Bitrix + QS). Não muda nada aqui.
  try {
    await fetch("/api/save-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
  } catch (e) {
    console.error("save-lead falhou", e);
  }

  // 3) REDIRECIONA.
  if (destino?.numero) {
    const texto = encodeURIComponent(
      `Oi ${destino.sdr_nome || ""}! Acabei de me inscrever na expedição ${dados.expedicao}.`.replace(/\s+/g, " ").trim()
    );
    // location.href, não window.open: depois de um await o navegador já não
    // considera isto "clique do usuário" e o bloqueador de pop-up mata a aba.
    window.location.href = `https://wa.me/${destino.numero}?text=${texto}`;
  } else {
    // Sem número não inventamos um: número de WhatsApp não mora no código da LP.
    // A pessoa vai pra página de obrigado e o SDR chama ela pelo card do CRM.
    window.location.href = "/obrigado.html";
  }
}

document.querySelector("#formulario").addEventListener("submit", aoEnviarFormulario);
```

## O mesmo trecho em React

```tsx
const QS_LEAD_URL = "https://qs-turis.vercel.app/api/lead";

async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  setEnviando(true);

  const dados = {
    nome, telefone, email,
    origem: "lp-japao",
    expedicao: "Japão — Outubro/2027",
    site: honeypot,
  };

  let destino: { numero: string; sdr_nome?: string } | null = null;
  try {
    const res = await fetch(QS_LEAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
      signal: AbortSignal.timeout(4000),
    });
    const json = await res.json();
    if (json?.numero) destino = json;
  } catch { /* segue pro fallback */ }

  try {
    await fetch("/api/save-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
  } catch { /* o ledger de leads cobre */ }

  if (destino) {
    const texto = encodeURIComponent(`Oi ${destino.sdr_nome ?? ""}! Acabei de me inscrever na expedição ${dados.expedicao}.`);
    window.location.href = `https://wa.me/${destino.numero}?text=${texto}`;
  } else {
    window.location.href = "/obrigado.html";
  }
}
```

---

## Antes de subir a primeira LP

1. **Cadastrar os chips.** Enquanto `sdr_pool` estiver vazia, o endpoint responde com
   `WHATSAPP_FALLBACK` e todo mundo cai no mesmo número. O passo a passo está no rodapé
   de `supabase/migrations/0076_pool_de_numeros.sql`.
2. **Configurar `WHATSAPP_FALLBACK`** nas variáveis da Vercel do QS (só dígitos:
   `5511999999999`). É o único número que mora em variável de ambiente, e existe pra
   nenhum lead ficar sem destino.
3. **Conferir o domínio na allowlist.** Se a LP não estiver em
   `qs_settings.lp_origins`, o navegador é barrado com 403 e a pessoa vai direto pro
   `/obrigado.html` — funciona, mas sem WhatsApp. Domínio novo entra com um
   `update` na tabela, sem deploy.

## Como conferir que funcionou

```sql
-- Os bilhetes emitidos hoje e o card que nasceu de cada um:
select r.created_at, r.nome, r.expedicao, u.name as sdr, r.numero, r.lead_id
  from sdr_reservas r
  left join qs_users u on u.id = r.sdr_id
 where r.created_at::date = current_date
 order by r.created_at desc;

-- lead_id nulo = a pessoa foi pro WhatsApp mas o card não nasceu
-- (n8n falhou). É o alarme que vale acompanhar na primeira semana.
```

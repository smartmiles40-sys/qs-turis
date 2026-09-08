# Banco local — testar migration sem tocar em produção

Sobe um **Postgres 17 de verdade** na sua máquina, aplica a migration e roda os
testes. Sem Docker, sem instalar nada no Windows, sem chegar perto do Supabase.

O pacote `embedded-postgres` baixa os binários oficiais do Postgres na primeira
execução (uns 20 MB, fica em `node_modules`). O banco nasce numa pasta
temporária e é **apagado quando o teste termina**.

## Instalar (uma vez)

```bash
cd scripts/local-postgres
npm install
```

## Os dois testes

```bash
npm run teste        # o rodízio sob concorrência
npm run endpoint     # a rota /api/lead ponta a ponta
```

### `npm run teste` — o rodízio

Abre **30 conexões separadas**, espera todas estarem de pé e só então dispara as
30 chamadas de `reservar_sdr()` de uma vez. Confere:

- a distribuição ficou **10/10/10**;
- a ordem foi `Mariana → Victor → Yanca → Mariana…`, sem repetir e sem pular;
- o ponteiro fechou a volta (30 é múltiplo de 3).

Aceita outro volume: `node teste-rodizio-local.mjs 90`.

> **Por que 30 conexões e não uma só.** É a disputa que precisa ser provada. Numa
> conexão só as chamadas viram fila e o teste passaria mesmo se a trava não
> existisse — provaria nada.

### `npm run endpoint` — a rota HTTP

Sobe um **PostgREST de mentira** na frente do Postgres local e importa o
`api/lead.js` de verdade — o mesmo arquivo que vai pra Vercel, sem stub. Testa o
que o outro teste não alcança:

- CORS: domínio nosso passa, `...com.br.site-de-outra-pessoa.com` é barrado;
- `Cache-Control: no-store` e o cabeçalho de CDN da Vercel;
- telefone com máscara virando só dígitos;
- o mesmo telefone em formatos diferentes caindo no mesmo SDR;
- o campo-armadilha respondendo 200 **sem girar a roda**;
- o teto por IP (429 na 11ª chamada) e outro IP não sendo afetado;
- o fallback quando ninguém tem número ativo.

## Ver a tela

```bash
cd ../..
npm run dev
```

E abra <http://localhost:3000/numeros-preview.html>. É o componente de produção
com os dados trocados por memória — os botões funcionam, a confirmação aparece,
a troca acontece. Sem login e sem Supabase.

## O que este banco NÃO é

Não é o schema do QS inteiro (são 18 tabelas `qs_*`). O `esqueleto.sql` tem só o
que a 0076 encosta. Isso é de propósito: se a migration passar a depender de
outro objeto, quebra aqui — que é onde a gente quer descobrir.

# Bolinha do QS (app para Windows)

## O que é

Uma bolinha azul com "QS" que fica **flutuando por cima de todas as janelas** do Windows,
parecida com a bolinha do iPhone (AssistiveTouch). Dá pra arrastar pra qualquer canto da tela.
Clicou nela, abre um painel pequeno com os atalhos e avisos do QS.

- O **visual e os atalhos** do painel vêm do próprio site do QS (página `/?bolinha=1`, código em `src/bolinha/`).
  Ou seja: mudou o painel no site, todo mundo já vê, sem precisar instalar nada de novo.
- Este diretório (`desktop/`) é só a "casca" do Windows: a janela flutuante, o ícone perto do relógio
  (bandeja), as notificações do Windows e a atualização automática.
- O login do QS fica guardado: fechou e abriu de novo, continua logado.
- Sem internet, a bolinha fica cinza com um pontinho vermelho e tenta de novo sozinha a cada 30 segundos
  (clicar nela tenta na hora).

### Ícone perto do relógio (bandeja)

Clique com o botão direito no ícone azul "QS" perto do relógio:

- **Mostrar bolinha** — traz a bolinha de volta (se ela sumiu ou ficou fora da tela).
- **Abrir o QS** — abre o QS no navegador.
- **Iniciar com o Windows** — liga/desliga a bolinha abrir sozinha quando o computador liga (vem ligado).
- **Sair** — fecha a bolinha de verdade.

## Como gerar o instalador (.exe)

Precisa do Node.js instalado. No terminal, dentro desta pasta `desktop/`:

```bash
npm install
npm run build
```

O instalador sai em `desktop/dist/Bolinha-do-QS-Setup-1.0.0.exe`.

Outros comandos úteis:

| Comando | Para quê |
| --- | --- |
| `npm start` | Abre a bolinha sem instalar, apontando pro QS no ar. |
| `npm run dev` | Abre a bolinha apontando pro QS rodando no seu computador (`http://localhost:5173`). |
| `npx electron . --url=https://outro-endereco` | Testa contra qualquer endereço. Também dá pra usar a variável `QS_URL`. |
| `npm run icone` | Gera de novo os ícones em `assets/` (se mudar a cor/desenho em `scripts/gerar-icone.js`). |

## Como lançar uma versão nova (atualização automática)

A bolinha instalada nos computadores confere a cada 6 horas (e sempre que abre) se tem versão nova
no GitHub (Releases do repositório `smartmiles40-sys/qs-turis`). Se tiver, baixa sozinha e instala
quando a pessoa fechar a bolinha ou desligar o computador.

1. Aumente a versão em `desktop/package.json` (ex.: `"version": "1.0.0"` → `"1.0.1"`).
2. Crie um token do GitHub com permissão de escrever no repositório (Settings → Developer settings →
   Personal access tokens, escopo `repo`).
3. No terminal, dentro de `desktop/`:

   ```bash
   # Git Bash
   GH_TOKEN=seu_token_aqui npm run release
   ```

   ```powershell
   # PowerShell
   $env:GH_TOKEN = "seu_token_aqui"; npm run release
   ```

4. Isso cria um **rascunho** de release no GitHub com o `.exe` e o `latest.yml`. Entre em
   GitHub → Releases, confira e clique em **Publish release**. Só depois de publicado as bolinhas
   instaladas enxergam a atualização.

> Importante: só mudanças nesta pasta (`desktop/`) precisam de versão nova. Mudanças no painel
> (`src/bolinha/`) chegam sozinhas, porque o painel é o próprio site.

## Como a equipe instala

1. Baixe o `Bolinha-do-QS-Setup-X.Y.Z.exe` (link da página de Releases no GitHub, ou mande o arquivo direto).
2. Dê dois cliques. Como o instalador não tem "assinatura digital" (certificado pago), o Windows mostra
   uma tela azul **"O Windows protegeu o computador"**. Clique em **Mais informações** → **Executar assim mesmo**.
   Isso é esperado.
3. A instalação é automática (não pergunta nada) e a bolinha já aparece no canto de baixo à direita.
4. Clique na bolinha e faça login no QS uma vez. Pronto.
5. Na primeira vez que o QS mandar um aviso, o Windows pode perguntar se permite notificações — permita.

Para desinstalar: Configurações do Windows → Aplicativos → "Bolinha do QS" → Desinstalar.

## Detalhes técnicos (para quem for mexer)

- `main.js` — janela (sem moldura, transparente, sempre no topo, fora da barra de tarefas), tamanhos
  bolinha 64×64 e painel 380×560, posição lembrada em `%APPDATA%/Bolinha do QS/bolinha.json`, bandeja,
  arrastar, segurança de navegação, permissões e atualização automática.
- `preload.js` — expõe `window.qsDesktop` pra página (contrato com `src/bolinha/`).
- `offline.html` — bolinha local de "sem conexão".
- `scripts/gerar-icone.js` — desenha o ícone sem depender de nenhuma biblioteca.
- A sessão fica na partição `persist:qs-bolinha` (login do Supabase sobrevive a reinícios).
- Navegação só dentro do endereço do QS; qualquer outro link abre no navegador padrão (só `https`).
- Permissões liberadas: só notificação e copiar pra área de transferência.

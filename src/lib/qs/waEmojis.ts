// src/lib/qs/waEmojis.ts
// -----------------------------------------------------------------------------
// A lista de emojis do painel de atendimento — curada, não a tabela Unicode.
//
// Por que não uma biblioteca (emoji-mart e afins): as menores passam de 200 KB
// só de dado, pra entregar 1.800 emojis dos quais um SDR usa 40. O QS acabou de
// cortar 53% do bundle inicial; não faz sentido devolver tudo pra pôr um 👍 na
// tela. Aqui são 344 emojis escolhidos (7,8 KB gzip), e o arquivo inteiro entra
// por import() só quando o SDR abre o seletor pela primeira vez.
//
// As palavras-chave são em PORTUGUÊS porque quem digita é a SDR, não o Unicode:
// "aviao" tem que achar ✈️, "joia" tem que achar 👍. A busca ignora acento, então
// "coração" e "coracao" caem no mesmo lugar.
//
// A categoria "Viagem" é deliberadamente a maior: é uma agência de expedição —
// avião, praia, montanha e passaporte são vocabulário de trabalho aqui.
// -----------------------------------------------------------------------------

/** Um emoji e as palavras que devem encontrá-lo. */
export type EmojiItem = readonly [emoji: string, chaves: string];

export interface EmojiCategoria {
  id: string;
  nome: string;
  /** Ícone da aba — um emoji da própria categoria, não um SVG. */
  icone: string;
  itens: readonly EmojiItem[];
}

export const CATEGORIAS: readonly EmojiCategoria[] = [
  {
    id: "rostos",
    nome: "Rostos",
    icone: "🙂",
    itens: [
      ["😀", "sorriso feliz alegre rosto"],
      ["😃", "sorriso feliz animado"],
      ["😄", "sorriso alegre rindo"],
      ["😁", "sorriso dentes contente"],
      ["😆", "rindo risada gargalhada"],
      ["😅", "rindo alivio suor nervoso"],
      ["🤣", "rolando de rir gargalhada kkk"],
      ["😂", "chorando de rir kkk risada"],
      ["🙂", "sorriso leve simpatico"],
      ["🙃", "de cabeca pra baixo ironia"],
      ["😉", "piscada piscadinha"],
      ["😊", "sorriso timido feliz gentil"],
      ["😇", "anjo santo inocente"],
      ["🥰", "apaixonado amor coracoes carinho"],
      ["😍", "apaixonado olhos de coracao amei"],
      ["🤩", "estrela deslumbrado uau incrivel"],
      ["😘", "beijo beijinho"],
      ["😋", "delicia gostoso lambendo"],
      ["😛", "lingua brincadeira"],
      ["😜", "lingua piscada brincadeira"],
      ["🤪", "maluco doido brincadeira"],
      ["🤗", "abraco acolhida"],
      ["🤭", "risinho ops boca tapada"],
      ["🤫", "silencio segredo shh"],
      ["🤔", "pensando duvida hmm"],
      ["🤨", "desconfiado sobrancelha duvida"],
      ["😐", "neutro sem reacao"],
      ["😑", "sem expressao entediado"],
      ["😶", "sem boca calado"],
      ["😏", "malicioso sorrisinho"],
      ["🙄", "revirando os olhos ah"],
      ["😬", "constrangido careta eita"],
      ["😌", "aliviado tranquilo calmo"],
      ["😔", "triste desanimado chateado"],
      ["😴", "dormindo sono zzz"],
      ["🤤", "babando desejo"],
      ["😷", "mascara doente"],
      ["🤒", "doente febre termometro"],
      ["🥵", "calor quente derretendo"],
      ["🥶", "frio congelando gelo"],
      ["😵", "tonto atordoado"],
      ["🤯", "explodindo mente chocado uau"],
      ["🤠", "cowboy chapeu aventura"],
      ["🥳", "festa comemorando parabens"],
      ["😎", "oculos de sol estiloso tranquilo"],
      ["🤓", "nerd estudioso oculos"],
      ["🧐", "monoculo analisando curioso"],
      ["😕", "confuso incerto"],
      ["🙁", "triste chateado"],
      ["😮", "surpreso boca aberta uau"],
      ["😲", "chocado espantado"],
      ["😳", "envergonhado corado surpreso"],
      ["🥺", "suplicante por favor pidao"],
      ["😢", "chorando triste lagrima"],
      ["😭", "chorando muito desesperado"],
      ["😱", "grito medo panico"],
      ["😞", "decepcionado triste"],
      ["😩", "cansado exausto"],
      ["🥱", "bocejo sono entediado"],
      ["😤", "irritado bufando"],
      ["😡", "bravo raiva furioso"],
      ["🤬", "xingando furia palavrao"],
      ["🥲", "sorriso com lagrima emocionado"],
      ["🤡", "palhaco"],
      ["👻", "fantasma assombracao"],
      ["🤖", "robo bot automacao"],
      ["💀", "caveira morto morri"],
      ["😈", "diabinho travesso"],
    ],
  },
  {
    id: "gestos",
    nome: "Gestos",
    icone: "👍",
    itens: [
      ["👍", "joia positivo curtir ok legal beleza sim show"],
      ["👎", "negativo nao ruim"],
      ["👌", "ok certo perfeito otimo"],
      ["✌️", "paz vitoria dois"],
      ["🤞", "dedos cruzados torcendo sorte"],
      ["🤙", "shaka me liga relaxa"],
      ["👏", "palmas aplausos parabens bravo"],
      ["🙌", "maos pra cima aleluia comemorando"],
      ["🙏", "obrigado por favor oracao gratidao"],
      ["🤝", "aperto de mao acordo fechado negocio parceria venda"],
      ["💪", "forca musculo bora firme"],
      ["🫶", "coracao com as maos amor carinho"],
      ["👋", "oi tchau ola aceno"],
      ["🤚", "mao parada espera"],
      ["✋", "mao aberta pare"],
      ["👉", "aponta direita olha aqui"],
      ["👈", "aponta esquerda"],
      ["👇", "aponta pra baixo veja abaixo"],
      ["👆", "aponta pra cima veja acima"],
      ["☝️", "dedo indicador atencao um"],
      ["✍️", "escrevendo anotando assinatura"],
      ["🤷", "sei la ombros duvida"],
      ["🤦", "facepalm vergonha ai meu deus"],
      ["🙋", "mao levantada eu presente"],
      ["🙅", "nao pode negado proibido"],
      ["🙆", "ok certo tudo bem"],
      ["💁", "informando atendimento aqui"],
      ["🙇", "reverencia desculpa obrigado"],
      ["🚶", "andando caminhando"],
      ["🏃", "correndo rapido pressa"],
      ["💃", "dancando festa comemorando"],
      ["🕺", "dancando festa"],
      ["🧘", "meditando calma yoga relaxar"],
      ["🧗", "escalada montanha aventura"],
      ["🏄", "surf praia onda"],
      ["🏊", "natacao nadando piscina"],
      ["🚴", "bicicleta pedalando ciclismo"],
      ["👤", "pessoa perfil contato"],
      ["👥", "pessoas grupo dupla"],
      ["👨‍👩‍👧", "familia casal filhos"],
    ],
  },
  {
    id: "coracao",
    nome: "Coração",
    icone: "❤️",
    itens: [
      ["❤️", "coracao amor vermelho"],
      ["🧡", "coracao laranja"],
      ["💛", "coracao amarelo"],
      ["💚", "coracao verde"],
      ["💙", "coracao azul"],
      ["💜", "coracao roxo"],
      ["🖤", "coracao preto"],
      ["🤍", "coracao branco"],
      ["🤎", "coracao marrom"],
      ["💔", "coracao partido triste"],
      ["❣️", "coracao exclamacao"],
      ["💕", "dois coracoes amor"],
      ["💞", "coracoes girando amor"],
      ["💗", "coracao crescendo"],
      ["💖", "coracao brilhando"],
      ["💘", "coracao flechado paixao"],
      ["💝", "coracao presente"],
      ["😻", "gato apaixonado amei"],
      ["💋", "beijo batom"],
      ["🌹", "rosa flor romance"],
    ],
  },
  {
    id: "viagem",
    nome: "Viagem",
    icone: "✈️",
    itens: [
      ["✈️", "aviao voo viagem passagem embarque"],
      ["🛫", "decolagem partida ida aviao"],
      ["🛬", "pouso chegada volta aviao"],
      ["🎫", "passagem bilhete ingresso ticket"],
      ["🛂", "passaporte imigracao controle"],
      ["🧳", "mala bagagem viagem"],
      ["🎒", "mochila mochilao trilha"],
      ["🗺️", "mapa roteiro itinerario"],
      ["🧭", "bussola direcao norte aventura"],
      ["📍", "local ponto endereco aqui"],
      ["🌍", "mundo terra europa africa global"],
      ["🌎", "mundo terra america brasil"],
      ["🌏", "mundo terra asia oceania"],
      ["🏝️", "ilha praia paraiso tropical"],
      ["🏖️", "praia guarda sol areia verao"],
      ["🌴", "coqueiro palmeira tropical praia"],
      ["🌊", "mar onda oceano agua"],
      ["⛰️", "montanha pico serra"],
      ["🏔️", "montanha nevada pico neve"],
      ["🗻", "fuji montanha japao"],
      ["🌋", "vulcao islandia lava"],
      ["🏜️", "deserto atacama duna"],
      ["🏞️", "parque natureza paisagem rio"],
      ["🏕️", "acampamento camping fogueira"],
      ["⛺", "barraca camping acampar"],
      ["🌅", "nascer do sol amanhecer praia"],
      ["🌄", "nascer do sol montanha amanhecer"],
      ["🌇", "por do sol entardecer cidade"],
      ["🌃", "noite cidade estrelas"],
      ["🌉", "ponte noite cidade"],
      ["🏰", "castelo europa medieval"],
      ["🏯", "castelo japones japao"],
      ["⛩️", "torii japao templo"],
      ["🗼", "torre toquio paris marco"],
      ["🗽", "estatua da liberdade nova york eua"],
      ["🗿", "moai ilha de pascoa chile"],
      ["🏛️", "grecia roma templo historico museu"],
      ["⛪", "igreja capela"],
      ["🕌", "mesquita marrocos turquia"],
      ["🐧", "pinguim antartica patagonia"],
      ["🐻‍❄️", "urso polar artico"],
      ["🦭", "foca antartica"],
      ["🐋", "baleia oceano avistamento"],
      ["🐬", "golfinho mar"],
      ["🦁", "leao safari africa"],
      ["🐘", "elefante safari africa"],
      ["🦒", "girafa safari africa"],
      ["🦓", "zebra safari africa"],
      ["🦜", "arara papagaio amazonia"],
      ["🐊", "jacare amazonia pantanal"],
      ["🐆", "onca leopardo pantanal"],
      ["🦌", "cervo alce natureza"],
      ["🐎", "cavalo cavalgada"],
      ["🦋", "borboleta natureza"],
      ["🌺", "flor tropical havai"],
      ["🌻", "girassol flor sol"],
      ["🌸", "cerejeira sakura japao flor"],
      ["🍁", "outono folha canada"],
      ["🌲", "pinheiro floresta mata"],
      ["🌵", "cacto deserto mexico"],
      ["☀️", "sol calor tempo bom verao"],
      ["⛅", "parcialmente nublado tempo"],
      ["🌧️", "chuva chovendo tempo"],
      ["⛈️", "tempestade raio chuva"],
      ["❄️", "neve frio inverno gelo"],
      ["⛄", "boneco de neve inverno"],
      ["🌈", "arco iris chuva colorido"],
      ["🌌", "via lactea estrelas aurora ceu"],
      ["🌙", "lua noite"],
      ["⭐", "estrela avaliacao favorito"],
      ["🚗", "carro dirigir aluguel"],
      ["🚐", "van transfer grupo"],
      ["🚌", "onibus excursao transfer"],
      ["🚙", "jipe 4x4 off road safari"],
      ["🏍️", "moto motocicleta"],
      ["🚲", "bicicleta passeio"],
      ["🚂", "trem locomotiva ferrovia"],
      ["🚆", "trem estacao"],
      ["🚡", "teleferico bondinho"],
      ["⛵", "veleiro barco vela"],
      ["🛳️", "cruzeiro navio transatlantico"],
      ["⛴️", "balsa ferry barco"],
      ["🚤", "lancha barco rapido"],
      ["🛶", "canoa caiaque remo rio"],
      ["🚁", "helicoptero sobrevoo"],
      ["🚀", "foguete lancamento decolar"],
      ["🏨", "hotel hospedagem"],
      ["🏡", "casa pousada"],
      ["🛏️", "cama quarto hospedagem diaria"],
      ["🧖", "spa relaxar termas"],
      ["♨️", "termas fonte quente onsen"],
      ["📸", "foto camera registro"],
      ["🎥", "filmagem video camera"],
      ["🕶️", "oculos de sol"],
      ["🧴", "protetor solar creme"],
      ["🥾", "bota trilha caminhada"],
      ["🎿", "esqui neve inverno"],
      ["🤿", "mergulho snorkel"],
    ],
  },
  {
    id: "comida",
    nome: "Comida",
    icone: "🍽️",
    itens: [
      ["🍽️", "prato refeicao almoco jantar"],
      ["🍕", "pizza"],
      ["🍔", "hamburguer lanche"],
      ["🍟", "batata frita"],
      ["🥪", "sanduiche lanche"],
      ["🌮", "taco mexicano"],
      ["🥗", "salada saudavel"],
      ["🍝", "macarrao massa italiano"],
      ["🍜", "lamen sopa asia"],
      ["🍣", "sushi japao"],
      ["🍤", "camarao frutos do mar"],
      ["🥘", "paella panela ensopado"],
      ["🥩", "carne churrasco bife"],
      ["🍗", "frango coxa"],
      ["🥐", "croissant frances padaria"],
      ["🧀", "queijo"],
      ["🍞", "pao padaria cafe da manha"],
      ["🥞", "panqueca cafe da manha"],
      ["🍰", "bolo fatia sobremesa"],
      ["🎂", "bolo aniversario parabens"],
      ["🍫", "chocolate doce"],
      ["🍦", "sorvete gelado"],
      ["☕", "cafe cafezinho"],
      ["🍵", "cha matcha"],
      ["🧉", "chimarrao mate erva sul"],
      ["🥤", "refrigerante bebida copo"],
      ["🍺", "cerveja chopp"],
      ["🍻", "brinde cerveja comemorar"],
      ["🍷", "vinho taca"],
      ["🥂", "brinde taca comemorar celebrar"],
      ["🍾", "champanhe espumante comemorar"],
      ["🍹", "drink coquetel praia"],
      ["🍎", "maca fruta"],
      ["🍌", "banana fruta"],
      ["🍇", "uva vinho fruta"],
      ["🍓", "morango fruta"],
      ["🍉", "melancia fruta verao"],
      ["🍍", "abacaxi fruta tropical"],
      ["🥥", "coco tropical praia"],
      ["🧊", "gelo frio"],
    ],
  },
  {
    id: "trabalho",
    nome: "Trabalho",
    icone: "📅",
    itens: [
      ["📱", "celular whatsapp telefone"],
      ["📞", "telefone ligacao ligar chamada call"],
      ["📲", "chamada recebida celular"],
      ["💬", "conversa mensagem chat balao"],
      ["✉️", "email carta mensagem"],
      ["📩", "email recebido mensagem"],
      ["📤", "enviado saida"],
      ["📥", "recebido caixa de entrada"],
      ["📎", "anexo clipe arquivo"],
      ["🔗", "link url endereco"],
      ["📝", "anotacao escrever nota bloco"],
      ["📅", "calendario data agenda reuniao compromisso"],
      ["🗓️", "agenda calendario reuniao compromisso marcada"],
      ["⏰", "despertador horario alarme lembrete"],
      ["⏳", "ampulheta prazo esperando tempo"],
      ["🕐", "relogio hora horario"],
      ["💼", "maleta trabalho negocio profissional reuniao"],
      ["📊", "grafico barras relatorio dados"],
      ["📈", "grafico subindo crescimento meta batida"],
      ["📉", "grafico caindo queda"],
      ["💰", "dinheiro saco grana valor"],
      ["💵", "dinheiro nota dolar pagamento"],
      ["💳", "cartao de credito pagamento parcelar"],
      ["🧾", "recibo nota fiscal comprovante"],
      ["🏦", "banco transferencia pix"],
      ["✅", "confirmado feito ok certo pronto sim"],
      ["☑️", "marcado checado item"],
      ["❌", "errado nao cancelado x"],
      ["📌", "fixar importante alfinete"],
      ["📋", "prancheta lista checklist"],
      ["📄", "documento arquivo pdf contrato"],
      ["📚", "livros material estudo"],
      ["🔍", "buscar procurar lupa pesquisa"],
      ["🔑", "chave acesso senha"],
      ["🔒", "cadeado seguro privado"],
      ["💻", "notebook computador"],
      ["🖥️", "computador monitor"],
      ["🖨️", "impressora imprimir"],
      ["🔔", "sino aviso notificacao lembrete"],
      ["📢", "megafone anuncio aviso divulgar"],
      ["💡", "ideia lampada sugestao"],
      ["🛒", "carrinho compra comprar"],
      ["🎁", "presente brinde bonus"],
      ["🏆", "trofeu vitoria campeao meta"],
      ["🥇", "primeiro lugar ouro medalha"],
      ["🎯", "alvo meta objetivo foco"],
      ["🚩", "bandeira alerta marcado"],
      ["🏁", "bandeira quadriculada fim chegada"],
    ],
  },
  {
    id: "simbolos",
    nome: "Símbolos",
    icone: "✨",
    itens: [
      ["✨", "brilho magia especial"],
      ["🎉", "festa parabens comemorar confete"],
      ["🎊", "confete festa comemorar"],
      ["🔥", "fogo quente demais top bombando"],
      ["💯", "cem por cento nota maxima total"],
      ["⚡", "raio energia rapido"],
      ["🌟", "estrela brilhante destaque"],
      ["💫", "estrela girando magia"],
      ["🎈", "balao festa"],
      ["👑", "coroa rei realeza vip"],
      ["💎", "diamante joia premium luxo"],
      ["⚠️", "atencao alerta cuidado aviso"],
      ["❗", "exclamacao importante urgente"],
      ["❓", "duvida pergunta interrogacao"],
      ["‼️", "muito importante urgente"],
      ["🆕", "novo lancamento novidade"],
      ["🆗", "ok certo"],
      ["🔝", "topo melhor top"],
      ["🔄", "atualizar repetir sincronizar"],
      ["➡️", "seta direita proximo"],
      ["⬅️", "seta esquerda voltar"],
      ["⬆️", "seta acima subir"],
      ["⬇️", "seta abaixo descer"],
      ["🔴", "bolinha vermelha parado urgente"],
      ["🟡", "bolinha amarela atencao andamento"],
      ["🟢", "bolinha verde ok liberado"],
      ["🔵", "bolinha azul"],
      ["♻️", "reciclar sustentavel eco"],
      ["🇧🇷", "brasil bandeira brasileira"],
      ["💤", "sono zzz dormindo inativo"],
    ],
  },
] as const;

// ── Recentes ────────────────────────────────────────────────────────────────
// Guardado por navegador. Na prática uma SDR usa os mesmos 8 emojis o dia todo;
// sem isto ela reabre a mesma categoria trinta vezes por dia.

const RECENTES_KEY = "qs_wa_emoji_recentes";
const RECENTES_MAX = 24;

export function lerRecentes(): string[] {
  try {
    const cru = window.localStorage.getItem(RECENTES_KEY);
    const arr: unknown = cru ? JSON.parse(cru) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, RECENTES_MAX) : [];
  } catch {
    return [];   // navegação anônima / storage bloqueado
  }
}

export function guardarRecente(emoji: string): string[] {
  const lista = [emoji, ...lerRecentes().filter((e) => e !== emoji)].slice(0, RECENTES_MAX);
  try {
    window.localStorage.setItem(RECENTES_KEY, JSON.stringify(lista));
  } catch { /* anônimo: perde os recentes, não quebra o envio */ }
  return lista;
}

// ── Busca ───────────────────────────────────────────────────────────────────

/** Tira acento pra "coracao" achar "coração". */
function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Índice montado uma vez, na primeira busca: a lista é constante, refazer o
// normalize de ~340 strings a cada tecla é trabalho jogado fora.
let indice: { emoji: string; palavras: string[]; cat: string }[] | null = null;

function pegarIndice() {
  if (!indice) {
    indice = CATEGORIAS.flatMap((c) => {
      const cat = semAcento(c.nome);
      return c.itens.map(([emoji, chaves]) => ({
        emoji,
        palavras: semAcento(chaves).split(/\s+/).filter(Boolean),
        cat,
      }));
    });
  }
  return indice;
}

/**
 * Busca por palavra-chave. Duas regras:
 *
 *  • O termo precisa COMEÇAR uma palavra, não só aparecer nela. Com "contém",
 *    digitar "ok" trazia 💻 — porque "ok" está dentro de "noteb-ook". Prefixo
 *    ainda deixa "avi" achar ✈️, que é como as pessoas realmente digitam.
 *  • Todos os termos precisam bater (busca "E", não "OU"): quem digita
 *    "sol praia" quer os dois juntos, não a soma dos dois.
 *
 * O nome da categoria também busca ("viagem" traz a categoria inteira), mas por
 * igualdade EXATA: por prefixo, "sim" abria "Símbolos" inteiro e enterrava o 👍.
 */
export function buscarEmojis(q: string, limite = 200): string[] {
  const termos = semAcento(q).split(/\s+/).filter(Boolean);
  if (!termos.length) return [];
  const achados: string[] = [];
  for (const item of pegarIndice()) {
    if (termos.every((t) => item.cat === t || item.palavras.some((p) => p.startsWith(t)))) {
      achados.push(item.emoji);
      if (achados.length >= limite) break;
    }
  }
  return achados;
}

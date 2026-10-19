// src/rel/viagens/destinos.ts
// -----------------------------------------------------------------------------
// DESTINO → LUGAR NO MAPA.
//
// O destino vem do Bitrix em texto livre e bagunçado ("Japão e China",
// "Japão/China", "AMAZÔNIA", "DXB", "Madri/Barcelona", "Itália dos Sonhos:
// Milão, Toscana e Roma. Incluso: ..."). Aqui a gente:
//   1. corta a parte de descrição (depois de ":" ou ".");
//   2. tira acento e maiúscula;
//   3. procura cada apelido conhecido como PALAVRA INTEIRA (o mais comprido
//      primeiro, pra "vitoria da conquista" não virar "vitoria").
// Um texto pode dar vários lugares ("Japão e China" = 2 pontos). O que não
// for reconhecido aparece na lista "sem lugar no mapa" — é só acrescentar o
// apelido aqui.
// -----------------------------------------------------------------------------

export interface Lugar { id: string; nome: string; lat: number; lon: number }

const L = (id: string, nome: string, lat: number, lon: number): Lugar => ({ id, nome, lat, lon });

const LUGARES: Record<string, Lugar> = {
  japao: L("japao", "Japão", 35.68, 139.69),
  china: L("china", "China", 39.9, 116.4),
  tailandia: L("tailandia", "Tailândia", 13.75, 100.5),
  egito: L("egito", "Egito", 30.04, 31.24),
  islandia: L("islandia", "Islândia", 64.15, -21.94),
  peru: L("peru", "Peru", -13.53, -71.97),
  machupicchu: L("machupicchu", "Machu Picchu", -13.16, -72.55),
  amazonia: L("amazonia", "Amazônia", -3.12, -60.02),
  turquia: L("turquia", "Turquia", 41.01, 28.98),
  grecia: L("grecia", "Grécia", 37.98, 23.73),
  dubai: L("dubai", "Dubai", 25.2, 55.27),
  italia: L("italia", "Itália", 41.9, 12.5),
  milao: L("milao", "Milão", 45.46, 9.19),
  toscana: L("toscana", "Toscana", 43.77, 11.25),
  amalfi: L("amalfi", "Costa Amalfitana", 40.63, 14.6),
  espanha: L("espanha", "Madri", 40.42, -3.7),
  barcelona: L("barcelona", "Barcelona", 41.39, 2.17),
  escandinavia: L("escandinavia", "Escandinávia", 59.33, 18.07),
  noruega: L("noruega", "Noruega", 59.91, 10.75),
  finlandia: L("finlandia", "Finlândia", 66.5, 25.73),
  cancun: L("cancun", "Cancún", 21.16, -86.85),
  cartagena: L("cartagena", "Cartagena", 10.39, -75.51),
  pereira: L("pereira", "Pereira", 4.81, -75.69),
  colombia: L("colombia", "Colômbia", 4.71, -74.07),
  joanesburgo: L("joanesburgo", "Joanesburgo", -26.2, 28.05),
  cidadedocabo: L("cidadedocabo", "Cidade do Cabo", -33.92, 18.42),
  toronto: L("toronto", "Toronto", 43.65, -79.38),
  paris: L("paris", "Paris", 48.86, 2.35),
  londres: L("londres", "Londres", 51.51, -0.13),
  portugal: L("portugal", "Lisboa", 38.72, -9.14),
  marrocos: L("marrocos", "Marrocos", 31.63, -7.99),
  patagonia: L("patagonia", "Patagônia", -50.34, -72.27),
  atacama: L("atacama", "Atacama", -22.91, -68.2),
  chile: L("chile", "Santiago", -33.45, -70.67),
  argentina: L("argentina", "Buenos Aires", -34.6, -58.38),
  novayork: L("novayork", "Nova York", 40.71, -74.0),
  orlando: L("orlando", "Orlando", 28.54, -81.38),
  maldivas: L("maldivas", "Maldivas", 3.2, 73.22),
  bali: L("bali", "Bali", -8.34, 115.09),
  india: L("india", "Índia", 28.61, 77.21),
  vietna: L("vietna", "Vietnã", 21.03, 105.85),
  coreia: L("coreia", "Coreia do Sul", 37.57, 126.98),
  alemanha: L("alemanha", "Alemanha", 52.52, 13.4),
  suica: L("suica", "Suíça", 46.95, 7.45),
  croacia: L("croacia", "Croácia", 45.81, 15.98),
  australia: L("australia", "Austrália", -33.87, 151.21),
  novazelandia: L("novazelandia", "Nova Zelândia", -36.85, 174.76),
  jordania: L("jordania", "Jordânia", 31.95, 35.93),
  israel: L("israel", "Israel", 31.77, 35.21),
  quenia: L("quenia", "Quênia", -1.29, 36.82),
  tanzania: L("tanzania", "Tanzânia", -3.37, 36.68),
  mexico: L("mexico", "Cidade do México", 19.43, -99.13),
  // Brasil
  saopaulo: L("saopaulo", "São Paulo", -23.55, -46.63),
  campinas: L("campinas", "Campinas", -23.0, -47.13),
  rio: L("rio", "Rio de Janeiro", -22.91, -43.17),
  fortaleza: L("fortaleza", "Fortaleza", -3.73, -38.53),
  natal: L("natal", "Natal", -5.79, -35.21),
  vitoria: L("vitoria", "Vitória", -20.32, -40.34),
  vitoriaconquista: L("vitoriaconquista", "Vitória da Conquista", -14.86, -40.84),
  pelotas: L("pelotas", "Pelotas", -31.77, -52.34),
  petropolis: L("petropolis", "Petrópolis", -22.51, -43.18),
  caruaru: L("caruaru", "Caruaru", -8.28, -35.98),
  salvador: L("salvador", "Salvador", -12.97, -38.5),
  recife: L("recife", "Recife", -8.05, -34.88),
  maceio: L("maceio", "Maceió", -9.67, -35.74),
  noronha: L("noronha", "Fernando de Noronha", -3.85, -32.42),
  gramado: L("gramado", "Gramado", -29.38, -50.87),
  foz: L("foz", "Foz do Iguaçu", -25.52, -54.59),
  jalapao: L("jalapao", "Jalapão", -10.33, -46.56),
  lencois: L("lencois", "Lençóis Maranhenses", -2.48, -43.13),
  bonito: L("bonito", "Bonito", -21.13, -56.49),
  pantanal: L("pantanal", "Pantanal", -16.6, -56.7),
  // 19/10: o que faltava na lista "sem lugar no mapa"
  eua: L("eua", "Estados Unidos", 38.9, -77.04),
  miami: L("miami", "Miami", 25.76, -80.19),
  detroit: L("detroit", "Detroit", 42.33, -83.05),
  phoenix: L("phoenix", "Phoenix", 33.45, -112.07),
  europa: L("europa", "Europa", 50.11, 8.68),
  amsterda: L("amsterda", "Amsterdã", 52.37, 4.9),
  veneza: L("veneza", "Veneza", 45.44, 12.32),
  ibiza: L("ibiza", "Ibiza", 38.91, 1.43),
  budapeste: L("budapeste", "Budapeste", 47.5, 19.04),
  edimburgo: L("edimburgo", "Edimburgo", 55.95, -3.19),
  caboverde: L("caboverde", "Cabo Verde", 14.93, -23.51),
  curacao: L("curacao", "Curaçao", 12.12, -68.88),
  puntacana: L("puntacana", "Punta Cana", 18.58, -68.4),
  sanandres: L("sanandres", "San Andrés", 12.58, -81.7),
  assuncao: L("assuncao", "Assunção", -25.26, -57.58),
  montevideu: L("montevideu", "Montevidéu", -34.9, -56.16),
  doha: L("doha", "Doha", 25.29, 51.53),
  hongkong: L("hongkong", "Hong Kong", 22.32, 114.17),
  assua: L("assua", "Assuã / Abu Simbel", 24.09, 32.9),
  belem: L("belem", "Belém", -1.46, -48.5),
  saoluis: L("saoluis", "São Luís", -2.53, -44.3),
  jericoacoara: L("jericoacoara", "Jericoacoara", -2.79, -40.51),
  ilheus: L("ilheus", "Ilhéus", -14.79, -39.05),
  brasilia: L("brasilia", "Brasília", -15.79, -47.88),
  bh: L("bh", "Belo Horizonte", -19.92, -43.94),
  curitiba: L("curitiba", "Curitiba", -25.43, -49.27),
  florianopolis: L("florianopolis", "Florianópolis", -27.6, -48.55),
  portoalegre: L("portoalegre", "Porto Alegre", -30.03, -51.23),
  goiania: L("goiania", "Goiânia", -16.69, -49.26),
  campogrande: L("campogrande", "Campo Grande", -20.44, -54.65),
  navegantes: L("navegantes", "Navegantes", -26.9, -48.65),
  chapeco: L("chapeco", "Chapecó", -27.1, -52.62),
};

// Apelido (já sem acento, minúsculo) → lugar. Erros de digitação que já
// apareceram no Bitrix entram aqui também ("ialandia", "amalftana").
const APELIDOS: Record<string, string> = {
  japao: "japao", toquio: "japao", tokyo: "japao", kyoto: "japao", quioto: "japao", osaka: "japao", jpn: "japao",
  china: "china", pequim: "china", xangai: "china", beijing: "china",
  tailandia: "tailandia", bangkok: "tailandia", bkk: "tailandia", phuket: "tailandia", "chiang mai": "tailandia",
  egito: "egito", cairo: "egito", luxor: "egito",
  islandia: "islandia", ialandia: "islandia", reykjavik: "islandia",
  peru: "peru", cusco: "peru", cuzco: "peru", lima: "peru",
  "aguas calientes": "machupicchu", "machu picchu": "machupicchu",
  amazonia: "amazonia", manaus: "amazonia",
  turquia: "turquia", istambul: "turquia", capadocia: "turquia",
  grecia: "grecia", atenas: "grecia", santorini: "grecia",
  dxb: "dubai", dubai: "dubai", emirados: "dubai", "abu dhabi": "dubai",
  italia: "italia", roma: "italia",
  milao: "milao", toscana: "toscana", florenca: "toscana",
  "costa amalfitana": "amalfi", "costa amalftana": "amalfi", amalfi: "amalfi",
  espanha: "espanha", madri: "espanha", madrid: "espanha",
  barcelona: "barcelona",
  escandinavia: "escandinavia", suecia: "escandinavia", estocolmo: "escandinavia",
  noruega: "noruega", oslo: "noruega",
  finlandia: "finlandia", laponia: "finlandia",
  cancun: "cancun", cartagena: "cartagena", pereira: "pereira", colombia: "colombia", bogota: "colombia",
  joanesburgo: "joanesburgo", "africa do sul": "cidadedocabo", "cidade do cabo": "cidadedocabo",
  toronto: "toronto", canada: "toronto",
  paris: "paris", franca: "paris",
  londres: "londres", inglaterra: "londres",
  portugal: "portugal", lisboa: "portugal", porto: "portugal",
  marrocos: "marrocos", marrakech: "marrocos",
  patagonia: "patagonia", atacama: "atacama", chile: "chile", santiago: "chile",
  argentina: "argentina", "buenos aires": "argentina",
  "nova york": "novayork", "nova iorque": "novayork", "new york": "novayork", orlando: "orlando",
  maldivas: "maldivas", bali: "bali", indonesia: "bali", india: "india", vietna: "vietna", coreia: "coreia",
  alemanha: "alemanha", suica: "suica", croacia: "croacia", australia: "australia", "nova zelandia": "novazelandia",
  jordania: "jordania", petra: "jordania", israel: "israel", quenia: "quenia", tanzania: "tanzania",
  mexico: "mexico",
  "sao paulo": "saopaulo", gru: "saopaulo", guarulhos: "saopaulo",
  viracopos: "campinas", campinas: "campinas",
  "rio de janeiro": "rio", fortaleza: "fortaleza", natal: "natal",
  "vitoria da conquista": "vitoriaconquista", vitoria: "vitoria",
  pelotas: "pelotas", petropolis: "petropolis", caruaru: "caruaru",
  salvador: "salvador", recife: "recife", maceio: "maceio", noronha: "noronha", gramado: "gramado",
  "foz do iguacu": "foz", jalapao: "jalapao", lencois: "lencois", bonito: "bonito", pantanal: "pantanal",
  // 19/10
  "estados unidos": "eua", eua: "eua", usa: "eua", miami: "miami", detroit: "detroit", phoenix: "phoenix",
  europa: "europa", eurotrip: "europa", amsterdam: "amsterda", amsterda: "amsterda", veneza: "veneza", ibiza: "ibiza",
  budapeste: "budapeste", edimburgo: "edimburgo", escocia: "edimburgo",
  "cabo verde": "caboverde", curacao: "curacao", "punta cana": "puntacana", "republica dominicana": "puntacana",
  "san andres": "sanandres", assuncao: "assuncao", paraguai: "assuncao", montevideu: "montevideu", uruguai: "montevideu",
  doha: "doha", catar: "doha", "hong kong": "hongkong", "abu simbel": "assua", "vila nubia": "assua", assua: "assua",
  "bueno aires": "argentina", "rio de janeino": "rio", "santos dumont": "rio", johanesburgo: "joanesburgo",
  "machu pichu": "machupicchu", belem: "belem", "sao luis": "saoluis", barreirinhas: "lencois", atins: "lencois",
  jericoacoara: "jericoacoara", jeri: "jericoacoara", ilheus: "ilheus", brasilia: "brasilia", "belo horizonte": "bh",
  curitiba: "curitiba", florianopolis: "florianopolis", floripa: "florianopolis", "porto alegre": "portoalegre",
  goiania: "goiania", "campo grande": "campogrande", chapeco: "chapeco", hanoi: "vietna", "da nang": "vietna",
  sydney: "australia", auckland: "novazelandia",
};

// Código de aeroporto (IATA). Só vale quando o texto é SÓ código ("JFK - LGA",
// "BSB / POA", "DAD x HAN"): "for", "rec", "bel"… são palavras comuns também
// ("Se Tu For, Eu Vou" não é Fortaleza).
const IATA: Record<string, string> = {
  gru: "saopaulo", cgh: "saopaulo", vcp: "campinas", gig: "rio", sdu: "rio", bsb: "brasilia", cnf: "bh", plu: "bh",
  ssa: "salvador", rec: "recife", for: "fortaleza", nat: "natal", mcz: "maceio", fen: "noronha", bel: "belem",
  slz: "saoluis", jdo: "fortaleza", ios: "ilheus", vix: "vitoria", vdc: "vitoriaconquista", cwb: "curitiba", fln: "florianopolis",
  poa: "portoalegre", gyn: "goiania", cgr: "campogrande", nvt: "navegantes", xap: "chapeco", igu: "foz", man: "amazonia",
  bps: "salvador", "sp": "saopaulo",
  jfk: "novayork", lga: "novayork", ewr: "novayork", mia: "miami", mco: "orlando", dtw: "detroit", phx: "phoenix",
  yyz: "toronto", cun: "cancun", mex: "mexico", puj: "puntacana", cur: "curacao", adz: "sanandres", ctg: "cartagena", bog: "colombia",
  scl: "chile", eze: "argentina", aep: "argentina", asu: "assuncao", mvd: "montevideu", lim: "peru", cuz: "peru",
  lis: "portugal", opo: "portugal", mad: "espanha", bcn: "barcelona", ibz: "ibiza", cdg: "paris", ory: "paris", lhr: "londres", lgw: "londres",
  edi: "edimburgo", ams: "amsterda", fco: "italia", mxp: "milao", lin: "milao", vce: "veneza", flr: "toscana", nap: "amalfi",
  bud: "budapeste", ist: "turquia", saw: "turquia", ath: "grecia", kef: "islandia", cai: "egito", asw: "assua",
  dxb: "dubai", auh: "dubai", doh: "doha", jnb: "joanesburgo", cpt: "cidadedocabo", rak: "marrocos", cmn: "marrocos",
  hnd: "japao", nrt: "japao", kix: "japao", pek: "china", pvg: "china", pkx: "china", hkg: "hongkong", bkk: "tailandia", hkt: "tailandia",
  icn: "coreia", han: "vietna", sgn: "vietna", dad: "vietna", dps: "bali", mle: "maldivas", del: "india",
  syd: "australia", akl: "novazelandia", sid: "caboverde", rai: "caboverde",
};
const SO_CODIGOS = /^(\s*[a-z]{2,3}\s*([-/x>]|\s)?)+$/;

const CHAVES = Object.keys(APELIDOS).sort((a, b) => b.length - a.length);

export const normalizar = (t: string) =>
  ` ${t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

const cache = new Map<string, Lugar[]>();

/** Todos os lugares de um texto de destino (pode ser 0, 1 ou vários). */
export function lugaresDe(texto: string | null | undefined): Lugar[] {
  if (!texto?.trim()) return [];
  const chave = texto.trim();
  const ja = cache.get(chave);
  if (ja) return ja;
  // "Itália dos Sonhos: Milão, Toscana e Roma. Incluso: aéreo Gru/Mil..." → só o começo
  const cru = chave.split(/[:.]/)[0];
  let t = normalizar(cru);
  const achados = new Map<string, Lugar>();
  // Só códigos de aeroporto ("JFK - LGA", "HND/JFK")?
  if (SO_CODIGOS.test(cru.toLowerCase().replace(/[–—]/g, "-"))) {
    for (const c of t.trim().split(" ")) {
      const lugar = LUGARES[IATA[c]];
      if (lugar) achados.set(lugar.id, lugar);
    }
    if (achados.size) { const r = [...achados.values()]; cache.set(chave, r); return r; }
  }
  for (const k of CHAVES) {
    const alvo = ` ${k} `;
    if (t.includes(alvo)) {
      const lugar = LUGARES[APELIDOS[k]];
      if (lugar) achados.set(lugar.id, lugar);
      t = t.split(alvo).join(" ");
    }
  }
  const r = [...achados.values()];
  cache.set(chave, r);
  return r;
}

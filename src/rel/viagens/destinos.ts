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
};

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
  let t = normalizar(chave.split(/[:.]/)[0]);
  const achados = new Map<string, Lugar>();
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

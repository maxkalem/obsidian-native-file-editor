import type { TextDictionary } from "./dictionary";

/**
 * The bundled dictionaries of the text languages: what Unwrap needs to tell a
 * word's own hyphen (кое-что, self-evident, an-mhaith) from the hyphen a
 * printer put at a line end. Each holds the prefixes that take a hyphen, the
 * suffixes (particles) that follow one, and whole words; hand-written lists,
 * not exhaustive, and every one of them can be extended or replaced by a JSON
 * file of the same name in the vault's dictionaries folder. The decision they
 * feed is in `unwrap.ts` (`hyphenAttachment`): the text's own evidence comes
 * first, these lists second, a few language-independent rules last.
 *
 * `prefixes` and `suffixes` are written without the hyphen. `words` with a
 * hyphen are kept as they are; `words` without one say "this word exists",
 * so a split at any point is joined back to it.
 *
 * The lists are applied together, whatever the language of the text, so an
 * entry must not be a syllable ordinary words begin or end with: `pro-`,
 * `ex-`, `mid-`, `-out`, `-то`, `по-` all name real hyphenated forms and were
 * all left out, because `pro-|gram`, `ex-|ample`, `mid-|dle`, `with-|out`,
 * `прос-|то`, `по-|думати` are what a wrapper leaves far more often. Such
 * forms go into `words` whole (по-моєму, из-за), or are left to the evidence
 * of the text, which sees `кто-то` and `что-то` intact elsewhere. One-letter
 * parts, abbreviations, a digit before the hyphen, repeated parts and a
 * capital after the hyphen need no entry: rules cover them.
 */
export const TEXT_LANGUAGES: readonly TextDictionary[] = [
  {
    name: "Ukrainian",
    prefixes: ["будь", "казна", "хтозна", "бозна", "віце", "контр", "обер", "унтер", "лейб", "штабс"],
    suffixes: ["небудь", "будь", "таки"],
    words: [
      "будь-що", "будь-як", "будь-де", "будь-хто", "будь-який", "будь-коли", "будь-куди", "будь-ласка",
      "де-не-де", "коли-не-коли", "хоч-не-хоч", "віч-на-віч", "пліч-о-пліч", "все-таки", "як-от", "як-не-як",
      "з-під", "з-за", "з-поміж", "з-понад", "з-посеред", "з-перед", "з-над",
      "по-перше", "по-друге", "по-третє", "по-моєму", "по-твоєму", "по-своєму", "по-українськи", "по-новому", "по-старому",
      "ось-ось", "ледо-ледве", "ледве-ледве", "тихо-тихо", "де-факто", "де-юре", "тет-а-тет", "ва-банк", "екс-чемпіон", "міні-маркет",
    ],
  },
  {
    name: "English",
    prefixes: ["self", "non", "anti", "co", "all", "well", "half", "semi", "quasi", "multi", "neo", "pseudo", "vice", "great", "step", "ill", "mock", "ultra", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
    suffixes: ["based", "like", "free", "only", "up", "off", "style", "type", "related", "friendly", "oriented", "driven", "proof", "esque", "wide", "shaped", "sized", "minded", "hearted", "looking", "born", "made", "held", "owned", "bound", "odd", "plus", "class"],
    words: [
      "e-mail", "x-ray", "t-shirt", "well-being", "so-called", "long-term", "short-term", "full-time", "part-time",
      "up-to-date", "state-of-the-art", "mother-in-law", "father-in-law", "one-way", "two-way", "know-how", "check-in",
      "built-in", "plug-in", "follow-up", "start-up", "make-up", "break-up", "set-up", "warm-up", "run-down", "hands-on",
      "face-to-face", "ex-wife", "ex-husband", "pre-war", "post-war", "mid-air", "cross-border", "inter-city", "re-elect", "re-enter",
    ],
  },
  {
    name: "German",
    prefixes: ["vize", "nicht", "pseudo", "anti", "quasi", "öko", "kontra", "ober", "nord", "süd", "ost"],
    suffixes: [],
    words: ["e-mail", "u-bahn", "s-bahn", "o-saft", "x-mal", "x-beliebig", "so-so", "nord-süd", "ost-west", "schwarz-weiß", "rot-grün", "ex-frau", "ex-mann", "bio-laden", "mini-job"],
  },
  {
    name: "French",
    prefixes: [
      "anti", "non", "sous", "vice", "demi", "semi", "quasi", "néo", "pseudo", "contre", "après", "avant", "arrière",
      "porte", "garde", "grand", "petit", "saint", "sainte", "nord", "sud", "ouest", "moi", "toi", "lui", "elle", "nous", "vous",
      "eux", "elles", "celui", "celle", "ceux", "celles", "tire", "presse", "casse", "coupe", "lave", "ouvre", "pare", "pique",
      "rez", "rendez", "chef", "chez", "peut", "tout", "tête", "arc", "abat", "aide", "allume", "appuie", "haut",
      "dix", "vingt", "trente", "quarante", "cinquante", "soixante", "quatre",
    ],
    suffixes: ["même", "mêmes", "ci", "là", "je", "il", "on", "nous", "vous", "ils", "elles", "les", "lui", "leur", "moi", "toi", "y", "en", "t", "midi", "être", "dire", "un", "deux", "trois", "cinq", "six", "sept", "huit", "neuf", "dix", "vingt", "vingts", "clé", "clés"],
    words: [
      "peut-être", "c'est-à-dire", "au-dessus", "au-dessous", "au-delà", "au-devant", "là-bas", "là-haut", "là-dessus",
      "par-dessus", "par-dessous", "vis-à-vis", "rendez-vous", "week-end", "grand-mère", "grand-père", "après-midi",
      "soi-même", "chef-d'œuvre", "tête-à-tête", "va-et-vient", "sur-le-champ", "porte-monnaie", "porte-parole", "dis-le", "dites-le", "prends-la", "ex-mari", "ex-femme",
    ],
  },
  {
    name: "Italian",
    prefixes: ["vice", "anti", "neo", "pseudo", "socio", "italo", "franco", "anglo", "russo", "afro", "semi", "quasi"],
    suffixes: [],
    words: ["così-così", "sud-est", "sud-ovest", "nord-est", "nord-ovest", "anglo-americano", "italo-americano", "ex-marito", "ex-moglie", "euro-zona"],
  },
  {
    name: "Spanish",
    prefixes: ["anti", "vice", "franco", "hispano", "anglo", "socio", "político", "teórico", "físico", "histórico", "económico", "técnico", "ítalo"],
    suffixes: [],
    words: ["así-así", "franco-alemán", "hispano-americano", "físico-químico", "teórico-práctico", "político-económico", "ex-marido", "ex-mujer"],
  },
  {
    name: "Finnish",
    prefixes: ["tv", "ei", "anti", "dna"],
    suffixes: [],
    words: ["linja-auto", "raaka-aine", "kuu-ukko", "ala-arvoinen", "pika-apu", "ilta-aurinko", "maa-alue", "syys-lokakuu", "e-posti", "tv-ohjelma", "ex-mies", "ex-vaimo", "eu-maa"],
    note: "A hyphen between two identical vowels (linja-auto) is Finnish spelling, not a line break; the same-vowel rule keeps it without a list.",
  },
  {
    name: "Irish",
    prefixes: ["dea", "droch", "sean", "ró", "fíor", "ard", "príomh", "leas", "iar", "réamh", "comh", "sár", "frith", "mí", "neamh", "lán", "nua", "bh", "dt", "gc", "mb", "nd", "ng", "bp"],
    suffixes: ["sa", "se", "san", "sean", "ne"],
    words: ["an-mhaith", "an-mhór", "an-deas", "dea-thoil", "droch-shaol", "ró-mhór", "sean-nós", "lá-rá", "in-mharthana", "so-lúbtha", "do-dhéanta"],
    note: "The eclipsis and the t-/h-/n- prefixes (n-athair, t-athair, h-oíche) are one letter before the hyphen and need no entry; an- (an-mhaith) is left to the words and to the text's evidence, because an- begins too many English words.",
  },
  {
    name: "Scottish Gaelic",
    prefixes: ["dearg", "droch", "deagh", "sàr", "fìor", "mì", "ceann", "leth", "làn", "iar"],
    suffixes: ["sa", "se", "san", "sam", "ne", "e"],
    words: [
      "a-nis", "a-màireach", "a-muigh", "a-staigh", "a-rithist", "a-riamh", "a-nochd", "a-mach", "a-steach", "a-null", "a-nall",
      "a-bhos", "a-chaoidh", "a-raoir", "an-diugh", "an-dè", "an-dràsta", "an-còmhnaidh", "an-uiridh", "am-màireach",
      "gu-tà", "mu-thràth", "taigh-òsta", "taigh-tasgaidh", "ceann-suidhe", "bun-sgoil", "àrd-sgoil", "co-là", "co-obraiche", "ro-làimh", "ban-rìgh",
    ],
  },
  {
    name: "Welsh",
    prefixes: ["cyd", "ôl", "rhag", "prif", "uwch", "hunan", "ffug", "lled", "mân", "rhyng", "gogledd", "dwyrain", "gorllewin"],
    suffixes: ["lein", "ddwyrain", "orllewin", "ddydd"],
    words: ["ar-lein", "de-ddwyrain", "de-orllewin", "gogledd-ddwyrain", "gogledd-orllewin", "hunan-barch", "hen-daid", "hen-nain", "cyd-destun", "ôl-nodyn", "ail-law", "di-dor", "is-adran", "cam-drin", "pen-blwydd", "tan-ddaearol"],
  },
  {
    name: "Arabic",
    prefixes: ["abd", "abu", "ibn", "bint", "umm", "dhu"],
    suffixes: [],
    words: ["al-qaeda", "al-jazeera", "al-andalus", "al-kindi", "ibn-sina", "abu-bakr", "abd-allah"],
    note: "Arabic script is not hyphenated and takes no hyphens; these are the particles of Latin transliteration. al- and el- are left out as prefixes because al-|ways and el-|ement are what a wrapper leaves; a capital after the hyphen (al-Kindi) is kept by rule.",
  },
  {
    name: "Crimean Tatar",
    prefixes: [],
    suffixes: [],
    words: ["ana-baba", "bir-eki", "aş-suv", "yer-yurt", "kelip-ketip", "ана-баба", "бир-эки", "аш-сув", "ер-юрт"],
    note: "Hyphens join reduplicated and paired words (yavaş-yavaş, ana-baba) and attach suffixes to numerals and abbreviations (1990-ncı, BMT-nıñ): the repeat, digit and abbreviation rules cover those; this list holds the pairs.",
  },
  {
    name: "Norwegian",
    prefixes: ["ikke", "anti", "vise", "semi", "pseudo", "øst", "nord", "sør", "tv", "pc"],
    suffixes: [],
    words: ["e-post", "tv-serie", "pc-skjerm", "nord-sør", "øst-vest", "svart-hvitt", "rød-grønn", "eks-kone", "eks-mann", "eu-land"],
  },
  {
    name: "Swedish",
    prefixes: ["icke", "vice", "anti", "semi", "pseudo", "tv", "pc", "nord", "syd", "öst"],
    suffixes: [],
    words: ["e-post", "tv-serie", "pc-skärm", "s-form", "nord-syd", "öst-väst", "svart-vit", "röd-grön", "ex-fru", "ex-man", "eu-land"],
  },
  {
    name: "Russian",
    prefixes: ["кое", "кой", "вице", "контр", "обер", "унтер", "лейб", "штабс"],
    suffixes: ["либо", "нибудь", "таки"],
    words: [
      "из-за", "из-под", "по-за", "по-над", "всё-таки", "все-таки", "так-таки", "точь-в-точь", "крест-накрест",
      "чуть-чуть", "еле-еле", "едва-едва", "вот-вот", "мало-мальски", "во-первых", "во-вторых", "в-третьих",
      "по-русски", "по-моему", "по-твоему", "по-своему", "по-прежнему", "по-видимому", "по-разному", "по-новому", "по-старому",
      "кто-то", "что-то", "где-то", "когда-то", "как-то", "какой-то", "чей-то", "почему-то", "кое-что", "кое-как", "кое-кто",
      "тет-а-тет", "ва-банк", "де-факто", "де-юре", "нью-йоркский", "нью-йоркской", "экс-чемпион", "мини-маркет",
    ],
  },
];

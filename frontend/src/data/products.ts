import { productSchema, type Product } from '../lib/schema';

/**
 * Mock catalog. Each entry is validated against `productSchema` at module load so
 * malformed data fails fast. Image `src` values are filename stems resolved against
 * `src/assets/images/` by `src/lib/images.ts`.
 *
 * This is the single source the `catalog.ts` data layer reads. When the Fastify API
 * lands, only `catalog.ts` changes — this file goes away.
 */
const raw = [
  {
    slug: 'the-kura-vessel',
    name: 'The Kura Vessel',
    subtitle: 'Stoneware Vessel',
    price: 420,
    currency: 'EUR',
    category: 'Vessels',
    clayBody: 'Stoneware',
    badges: ['Limited Edition'],
    shortDescription: 'A silent custodian of space, hand-coiled from custom grogged clay.',
    description:
      'Emerging from the intersection of architectural brutalism and organic decay, the Kura Vessel serves as a silent custodian of space. Hand-coiled from a custom grogged clay body, its surface documents the violence and grace of the wood-firing process.',
    curatorsNote:
      'Named after traditional Japanese storehouses, the Kura Vessel explores themes of containment and preservation. The asymmetrical silhouette is intentionally distorted during the drying phase to capture the natural tension of the material settling under its own weight.',
    specs: {
      dimensions: 'H 42cm × W 28cm × D 25cm',
      weight: '4.2 kg',
      clayBody: 'High-iron dark stoneware with grog',
      firing: 'Anagama wood-fired for 72 hours',
      glaze: 'Natural ash glaze, unglazed interior',
    },
    edition: { ref: 'AR-04', count: 40, certificate: true, leadTime: 'Made to order · Ships in 3–5 weeks' },
    images: [
      { src: 'the-kura-vessel-1', alt: 'A tall, textured stoneware vessel resting on a rough stone plinth.' },
      { src: 'the-kura-vessel-2', alt: 'Close detail of the vessel’s carved, drying-cracked surface.' },
      { src: 'the-kura-vessel-3', alt: 'The vessel’s mouth and rim seen from above against a dark ground.' },
    ],
    relatedSlugs: ['tea-bowl-no-14', 'ash-incense-burner', 'the-slender-pitcher', 'monolith-platter'],
    seenInInteriors: {
      text: 'The Kura Vessel acts as a grounding anchor within minimalist architectural spaces, drawing the eye through its profound materiality and quiet presence.',
      image: { src: 'interior-kura', alt: 'A pale ceramic vessel on an oak sideboard in a sunlit interior.' },
    },
    featured: true,
    createdAt: '2024-05-12',
  },
  {
    slug: 'ash-glazed-vessel-no-1',
    name: 'Ash Glazed Vessel No. 1',
    subtitle: 'Kiln Style',
    price: 480,
    currency: 'EUR',
    category: 'Vessels',
    clayBody: 'Stoneware',
    badges: ['Limited Edition'],
    shortDescription: 'A meditation on raw materials and the unpredictable path of the flame.',
    description:
      'The first piece drawn from The First Firing. This collection embraces the unpredictable nature of wood-firing, resulting in surfaces that map the path of the flame across the clay.',
    curatorsNote:
      'No two pieces from the first firing are alike — the ash deposits settle differently with every load. This vessel carries the deepest flashing of the series along its leeward shoulder.',
    specs: {
      dimensions: 'H 36cm × W 24cm × D 24cm',
      weight: '3.6 kg',
      clayBody: 'Grogged stoneware',
      firing: 'Wood-fired, single firing',
      glaze: 'Self-glazing wood ash',
    },
    edition: { ref: 'AR-01', count: 25, certificate: true },
    images: [
      { src: 'ash-glazed-vessel-no-1-1', alt: 'A wood-fired stoneware vessel with mottled ash glazing.' },
      { src: 'ash-glazed-vessel-no-1-2', alt: 'Surface detail of ash flashing across the vessel shoulder.' },
    ],
    relatedSlugs: ['the-kura-vessel', 'veil-bud-vase'],
    featured: true,
    createdAt: '2024-05-20',
  },
  {
    slug: 'tsuki-basin',
    name: 'Tsuki Basin',
    subtitle: 'Charcoal Bowl',
    price: 320,
    currency: 'EUR',
    category: 'Bowls',
    clayBody: 'Stoneware',
    badges: [],
    shortDescription: 'A wide, low basin with a torn, lunar rim.',
    description:
      'A wide, low basin thrown and then altered while soft. The torn rim catches light like the edge of a crescent moon, while the dark stoneware body grounds it in shadow.',
    curatorsNote:
      'The rim is deliberately left raw and unglazed so the hand reads the grog when the basin is lifted — weight and texture as a quiet ritual.',
    specs: {
      dimensions: 'H 12cm × Ø 34cm',
      weight: '2.1 kg',
      clayBody: 'Dark stoneware',
      firing: 'Reduction-fired to cone 10',
      glaze: 'Matte charcoal glaze, raw rim',
    },
    images: [
      { src: 'tsuki-basin-1', alt: 'A dark charcoal stoneware basin with a torn rim on pale wood.' },
      { src: 'tsuki-basin-2', alt: 'Overhead view of the basin’s glazed interior.' },
    ],
    relatedSlugs: ['sienna-serving-bowl', 'tea-bowl-no-14', 'monolith-platter'],
    createdAt: '2024-04-02',
  },
  {
    slug: 'enso-rings',
    name: 'Enso Rings',
    subtitle: 'Sculptural Form',
    price: 850,
    currency: 'EUR',
    category: 'Sculptural',
    clayBody: 'Stoneware',
    badges: ['Made to Order'],
    shortDescription: 'A continuous coil of terracotta describing a single, unbroken gesture.',
    description:
      'A non-functional study in continuity. A single coil of burnished terracotta-toned stoneware loops through itself, describing the unbroken circle of the ensō — a gesture made once, without correction.',
    curatorsNote:
      'Each form is built around a temporary armature that burns away in the kiln, leaving the loop to hold its own tension. Commissions can be scaled to a plinth or shelf on request.',
    specs: {
      dimensions: 'H 38cm × W 40cm × D 18cm',
      weight: '5.4 kg',
      clayBody: 'Iron-rich stoneware',
      firing: 'Oxidation-fired to cone 6',
      glaze: 'Burnished terra slip, unglazed',
    },
    images: [
      { src: 'enso-rings-1', alt: 'A looping terracotta sculptural form on a white plinth.' },
      { src: 'enso-rings-2', alt: 'Side profile of the continuous coil sculpture.' },
    ],
    relatedSlugs: ['cairn-stack', 'the-kura-vessel'],
    createdAt: '2024-06-01',
  },
  {
    slug: 'tasting-plates-set',
    name: 'Tasting Plates Set',
    subtitle: 'Set of Three',
    price: 240,
    currency: 'EUR',
    category: 'Plates',
    clayBody: 'Earthenware',
    badges: [],
    shortDescription: 'Three small, irregular plates for slow, considered meals.',
    description:
      'A set of three small plates, each pinched to a slightly different diameter so they nest and overlap on the table. Made for tasting menus, single figs, and the ceremony of small portions.',
    curatorsNote:
      'The trio is fired together so their glazes pull from the same bucket on the same day — a matched set that could only have been made once.',
    specs: {
      dimensions: 'Ø 14cm, 16cm, 18cm',
      weight: '1.3 kg (set)',
      clayBody: 'Buff earthenware',
      firing: 'Oxidation-fired to cone 04',
      glaze: 'Bone matte, raw foot',
    },
    images: [
      { src: 'tasting-plates-set-1', alt: 'Three small irregular ceramic plates on neutral linen.' },
      { src: 'tasting-plates-set-2', alt: 'The three plates stacked and overlapping.' },
    ],
    relatedSlugs: ['monolith-platter', 'drift-plate-pair', 'tsuki-basin'],
    featured: true,
    createdAt: '2024-03-18',
  },
  {
    slug: 'tea-bowl-no-14',
    name: 'Tea Bowl No. 14',
    subtitle: 'Chawan',
    price: 190,
    currency: 'EUR',
    category: 'Bowls',
    clayBody: 'Stoneware',
    badges: [],
    shortDescription: 'A faceted chawan sized to be cradled in two hands.',
    description:
      'A tea bowl in the chawan tradition, faceted with a single trimming tool so each plane catches the glaze at a different depth. Sized and weighted to be held in two hands.',
    curatorsNote:
      'The fourteenth in an ongoing study. The foot is carved last, by feel, once the bowl has told the maker where its balance wants to sit.',
    specs: {
      dimensions: 'H 8cm × Ø 12cm',
      weight: '0.4 kg',
      clayBody: 'Speckled stoneware',
      firing: 'Reduction-fired to cone 10',
      glaze: 'Tenmoku over faceted body',
    },
    images: [
      { src: 'tea-bowl-no-14-1', alt: 'A small dark faceted tea bowl on a neutral surface.' },
    ],
    relatedSlugs: ['tsuki-basin', 'ash-incense-burner', 'the-kura-vessel'],
    createdAt: '2024-02-10',
  },
  {
    slug: 'ash-incense-burner',
    name: 'Ash Incense Burner',
    subtitle: 'Censer',
    price: 85,
    currency: 'EUR',
    category: 'Vessels',
    clayBody: 'Earthenware',
    badges: [],
    shortDescription: 'A small lidded censer with a hand-pierced canopy.',
    description:
      'A diminutive lidded burner for cone and stick incense alike. The domed canopy is pierced by hand so smoke escapes in slow, drifting threads.',
    curatorsNote:
      'The simplest object in the catalogue, and the most used. It earns its patina — ash settles into the pierced canopy and darkens it over years.',
    specs: {
      dimensions: 'H 9cm × Ø 10cm',
      weight: '0.3 kg',
      clayBody: 'Red earthenware',
      firing: 'Oxidation-fired to cone 04',
      glaze: 'Unglazed exterior, sealed well',
    },
    images: [
      { src: 'ash-incense-burner-1', alt: 'A small domed ceramic incense burner with pierced lid.' },
    ],
    relatedSlugs: ['tea-bowl-no-14', 'veil-bud-vase'],
    createdAt: '2023-11-22',
  },
  {
    slug: 'the-slender-pitcher',
    name: 'The Slender Pitcher',
    subtitle: 'Pourer',
    price: 260,
    currency: 'EUR',
    category: 'Tableware',
    clayBody: 'Porcelain',
    badges: ['Made to Order'],
    shortDescription: 'A tall porcelain pourer with a drawn, dripping shoulder glaze.',
    description:
      'A tall, narrow pitcher thrown in porcelain for a clean pour. A celadon glaze is allowed to break and drip over a raw clay shoulder, freezing the moment the glaze began to move.',
    curatorsNote:
      'The spout is pulled wet and tested with water before the bisque — a pitcher that does not pour cleanly never leaves the studio.',
    specs: {
      dimensions: 'H 26cm × W 12cm × D 11cm',
      weight: '0.9 kg',
      clayBody: 'Limoges porcelain',
      firing: 'Reduction-fired to cone 10',
      glaze: 'Celadon over raw clay shoulder',
    },
    images: [
      { src: 'the-slender-pitcher-1', alt: 'A tall pitcher with celadon glaze dripping over raw clay.' },
      { src: 'the-slender-pitcher-2', alt: 'Detail of the pitcher spout and drip line.' },
    ],
    relatedSlugs: ['lunar-carafe', 'snow-glaze-cup-set', 'monolith-platter'],
    createdAt: '2024-04-28',
  },
  {
    slug: 'monolith-platter',
    name: 'Monolith Platter',
    subtitle: 'Serving Platter',
    price: 310,
    currency: 'EUR',
    category: 'Plates',
    clayBody: 'Stoneware',
    badges: [],
    shortDescription: 'A wide, weighty platter with a single concentric throwing ring.',
    description:
      'A generous round platter, thrown thick and trimmed to a low foot. A single deep throwing ring spirals to the centre, a record of the wheel left intact beneath a slate glaze.',
    curatorsNote:
      'Heavy by design — the platter is meant to stay on the table between courses, a still point the meal returns to.',
    specs: {
      dimensions: 'H 4cm × Ø 36cm',
      weight: '2.8 kg',
      clayBody: 'Dark stoneware',
      firing: 'Reduction-fired to cone 10',
      glaze: 'Slate matte, raw foot',
    },
    images: [
      { src: 'monolith-platter-1', alt: 'A wide dark stoneware platter seen from above.' },
      { src: 'monolith-platter-2', alt: 'Profile of the platter showing its low foot.' },
    ],
    relatedSlugs: ['tasting-plates-set', 'tsuki-basin', 'drift-plate-pair'],
    createdAt: '2024-01-30',
  },
  {
    slug: 'lunar-carafe',
    name: 'Lunar Carafe',
    subtitle: 'Water Carafe',
    price: 180,
    currency: 'EUR',
    category: 'Tableware',
    clayBody: 'Porcelain',
    badges: [],
    shortDescription: 'A bedside carafe in translucent porcelain with a cup that caps it.',
    description:
      'A porcelain carafe slender enough for a bedside table, with a tumbler that inverts to cap the neck. Held to the light, the walls glow with the faint translucency only porcelain gives.',
    curatorsNote:
      'Thrown thin, on purpose, so the carafe sweats less and the water stays cool through the night.',
    specs: {
      dimensions: 'Carafe H 20cm · Cup H 8cm',
      weight: '0.7 kg (set)',
      clayBody: 'Translucent porcelain',
      firing: 'Oxidation-fired to cone 6',
      glaze: 'Clear satin',
    },
    images: [
      { src: 'lunar-carafe-1', alt: 'A slender white porcelain carafe with an inverted cup lid.' },
    ],
    relatedSlugs: ['snow-glaze-cup-set', 'the-slender-pitcher'],
    createdAt: '2024-03-05',
  },
  {
    slug: 'snow-glaze-cup-set',
    name: 'Snow Glaze Cup Set',
    subtitle: 'Set of Four',
    price: 140,
    currency: 'EUR',
    category: 'Tableware',
    clayBody: 'Porcelain',
    badges: [],
    shortDescription: 'Four small porcelain cups under a soft, snow-white crackle.',
    description:
      'A set of four stacking cups in porcelain, finished in a soft snow glaze that crackles finely as it cools. For tea, sake, or a single morning ristretto.',
    curatorsNote:
      'The crackle is encouraged, then steeped in tea by the maker so the lines warm from white to amber with use.',
    specs: {
      dimensions: 'H 6cm × Ø 7cm (each)',
      weight: '0.6 kg (set)',
      clayBody: 'Porcelain',
      firing: 'Oxidation-fired to cone 6',
      glaze: 'Snow crackle',
    },
    images: [
      { src: 'snow-glaze-cup-set-1', alt: 'Four small white porcelain cups, lightly crackled.' },
    ],
    relatedSlugs: ['lunar-carafe', 'drift-plate-pair'],
    createdAt: '2023-12-12',
  },
  {
    slug: 'veil-bud-vase',
    name: 'Veil Bud Vase',
    subtitle: 'Bud Vase',
    price: 120,
    currency: 'EUR',
    category: 'Vessels',
    clayBody: 'Porcelain',
    badges: [],
    shortDescription: 'A single-stem vase, thin enough to read the light through.',
    description:
      'A narrow bud vase for one stem and one leaf. The porcelain is pared back at the rim until it veils the light, a fragility held in check by a weighted base.',
    curatorsNote:
      'Made for restraint — a single ranunculus, a sprig of olive. The vase asks you to choose.',
    specs: {
      dimensions: 'H 16cm × Ø 6cm',
      weight: '0.3 kg',
      clayBody: 'Translucent porcelain',
      firing: 'Oxidation-fired to cone 6',
      glaze: 'Clear, unglazed rim',
    },
    images: [
      { src: 'veil-bud-vase-1', alt: 'A slim white porcelain bud vase holding a single stem.' },
    ],
    relatedSlugs: ['ash-glazed-vessel-no-1', 'ash-incense-burner'],
    createdAt: '2024-02-26',
  },
  {
    slug: 'terra-planter',
    name: 'Terra Planter',
    subtitle: 'Footed Planter',
    price: 220,
    currency: 'EUR',
    category: 'Vessels',
    clayBody: 'Earthenware',
    badges: [],
    shortDescription: 'A footed earthenware planter that breathes with the soil.',
    description:
      'A round, footed planter left unglazed on the outside so the porous earthenware breathes with the soil. The interior is sealed and drained for everyday planting.',
    curatorsNote:
      'The raw terracotta will bloom with a pale mineral haze over time — a patina the studio considers part of the work, not a flaw.',
    specs: {
      dimensions: 'H 22cm × Ø 24cm',
      weight: '2.4 kg',
      clayBody: 'Red earthenware',
      firing: 'Oxidation-fired to cone 04',
      glaze: 'Unglazed body, sealed interior',
    },
    images: [
      { src: 'terra-planter-1', alt: 'A round terracotta planter with a low foot.' },
    ],
    relatedSlugs: ['sienna-serving-bowl', 'enso-rings'],
    createdAt: '2024-01-08',
  },
  {
    slug: 'sienna-serving-bowl',
    name: 'Sienna Serving Bowl',
    subtitle: 'Serving Bowl',
    price: 165,
    currency: 'EUR',
    category: 'Bowls',
    clayBody: 'Earthenware',
    badges: [],
    shortDescription: 'A warm, generous bowl glazed the colour of dusk.',
    description:
      'A deep, wide serving bowl in warm earthenware, glazed in a sienna that pools darker toward the centre. Sized for grains, greens, and the middle of a shared table.',
    curatorsNote:
      'The glaze is layered twice so the rim stays light and the well deepens — a gradient pulled by gravity in the kiln.',
    specs: {
      dimensions: 'H 10cm × Ø 28cm',
      weight: '1.6 kg',
      clayBody: 'Buff earthenware',
      firing: 'Oxidation-fired to cone 04',
      glaze: 'Sienna gloss, pooling well',
    },
    images: [
      { src: 'sienna-serving-bowl-1', alt: 'A warm sienna-glazed earthenware serving bowl.' },
    ],
    relatedSlugs: ['tasting-plates-set', 'terra-planter', 'tsuki-basin'],
    createdAt: '2023-12-29',
  },
  {
    slug: 'cairn-stack',
    name: 'Cairn Stack',
    subtitle: 'Sculptural Form',
    price: 690,
    currency: 'EUR',
    category: 'Sculptural',
    clayBody: 'Stoneware',
    badges: ['Limited Edition'],
    shortDescription: 'A balanced stack of hollow stones marking a quiet path.',
    description:
      'Five hollow stoneware forms, thrown and altered, balanced into a cairn. A marker without a trail — the kind left to say only that someone stood here, and paused.',
    curatorsNote:
      'Each stone is weighted internally so the stack reads precarious but stands true. Disassembles for shipping and is rebuilt to a numbered diagram.',
    specs: {
      dimensions: 'H 52cm × Ø 22cm (assembled)',
      weight: '7.1 kg',
      clayBody: 'Grogged stoneware',
      firing: 'Reduction-fired to cone 10',
      glaze: 'Dry granite matte',
    },
    edition: { ref: 'AR-07', count: 15, certificate: true, leadTime: 'Made to order · Ships in 4–6 weeks' },
    images: [
      { src: 'cairn-stack-1', alt: 'A balanced stack of five hollow stoneware stones.' },
      { src: 'cairn-stack-2', alt: 'Detail of the dry granite glaze on the stacked forms.' },
    ],
    relatedSlugs: ['enso-rings', 'the-kura-vessel'],
    createdAt: '2024-06-10',
  },
  {
    slug: 'drift-plate-pair',
    name: 'Drift Plate Pair',
    subtitle: 'Set of Two',
    price: 130,
    currency: 'EUR',
    category: 'Plates',
    clayBody: 'Porcelain',
    badges: [],
    shortDescription: 'Two porcelain plates with a soft, drifting blue brushstroke.',
    description:
      'A pair of porcelain dinner plates, each carrying a single drifting brushstroke of soft blue under the glaze — the same gesture, made twice, never identical.',
    curatorsNote:
      'The brushwork is done in one breath on leather-hard clay. The pair you receive are the two that were painted as a conversation, side by side.',
    specs: {
      dimensions: 'Ø 26cm (each)',
      weight: '1.1 kg (pair)',
      clayBody: 'Porcelain',
      firing: 'Oxidation-fired to cone 6',
      glaze: 'Clear over cobalt brushwork',
    },
    images: [
      { src: 'drift-plate-pair-1', alt: 'Two white porcelain plates with soft blue brushstrokes.' },
    ],
    relatedSlugs: ['monolith-platter', 'snow-glaze-cup-set', 'tasting-plates-set'],
    createdAt: '2024-02-02',
  },
];

export const products: Product[] = raw.map((p) => productSchema.parse(p));

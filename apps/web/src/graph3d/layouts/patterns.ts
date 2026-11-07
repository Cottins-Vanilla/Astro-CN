/**
 * Real IAU constellation line-figure shapes, sourced from d3-celestial
 * (https://github.com/ofrohn/d3-celestial, BSD-3-Clause License,
 * Copyright (c) Olaf Frohn) and re-derived here (see
 * scripts/build-constellation-patterns.js) into the local, normalized
 * [-1,1] coordinate frame + single spanning tree `ConstellationLayout`
 * expects — one star per catalog point, one parent-tree edge per drawn
 * constellation line, projected from real right-ascension/declination onto
 * a local tangent plane centered on each constellation's own centroid. A
 * constellation's official figure is sometimes drawn as several disjoint
 * line segments (a MultiLineString); only the largest connected segment is
 * kept, so every pattern here is a single tree, matching this file's
 * existing shape. See docs/CONSTELLATION.md's "Named patterns" section and
 * docs/ARCH-CONSTELLATIONS.md for the matching algorithm this data feeds.
 *
 * Regenerate with `node scripts/build-constellation-patterns.js` — do not hand-edit.
 */
export interface ConstellationPattern {
  /** Stable identifier, e.g. "ori" (the source data's own IAU 3-letter code, lowercased). */
  id: string;
  /** Display name shown on the constellation label. */
  name: string;
  /** Star positions in a normalized local frame, roughly centered on (0,0),
   *  coordinates in [-1, 1]. Index 0 is the pattern's anchor (highest-degree star). */
  stars: ReadonlyArray<{ x: number; y: number }>;
  /** Spanning-tree parent for each star; parent[0] === -1. Used for slot
   *  ordering and for placing overflow companion nodes. Every star reachable
   *  from 0. */
  parent: ReadonlyArray<number>;
}

const ANT: ConstellationPattern = {
  id: "ant",
  name: "Antlia",
  stars: [{ x: 0.1949, y: 0.3667 }, { x: -1, y: -0.1238 }, { x: 0.8051, y: -0.2429 }],
  parent: [-1, 0, 0],
};

const CIR: ConstellationPattern = {
  id: "cir",
  name: "Circinus",
  stars: [{ x: -0.7767, y: -1 }, { x: 0.2983, y: 0.5659 }, { x: 0.4784, y: 0.4341 }],
  parent: [-1, 0, 0],
};

const COM: ConstellationPattern = {
  id: "com",
  name: "Coma Berenices",
  stars: [{ x: 0.5049, y: 0.4722 }, { x: 0.4439, y: -1 }, { x: -0.9487, y: 0.5278 }],
  parent: [-1, 0, 0],
};

const EQU: ConstellationPattern = {
  id: "equ",
  name: "Equuleus",
  stars: [{ x: 0.0717, y: 0.4806 }, { x: 0.175, y: -1 }, { x: -0.2467, y: 0.5194 }],
  parent: [-1, 0, 0],
};

const FOR: ConstellationPattern = {
  id: "for",
  name: "Fornax",
  stars: [{ x: 0.1927, y: -0.2694 }, { x: 0.8073, y: 0.1538 }, { x: -1, y: 0.1155 }],
  parent: [-1, 0, 0],
};

const OCT: ConstellationPattern = {
  id: "oct",
  name: "Octans",
  stars: [{ x: -1, y: -0.2298 }, { x: 0.6038, y: -0.0458 }, { x: 0.3962, y: 0.2756 }],
  parent: [-1, 0, 0],
};

const PIC: ConstellationPattern = {
  id: "pic",
  name: "Pictor",
  stars: [{ x: -0.4639, y: 0.0405 }, { x: 0.9913, y: -1 }, { x: -0.5273, y: 0.9595 }],
  parent: [-1, 0, 0],
};

const TEL: ConstellationPattern = {
  id: "tel",
  name: "Telescopium",
  stars: [{ x: 0.3808, y: 0.4966 }, { x: -0.9144, y: 0.5034 }, { x: 0.5336, y: -1 }],
  parent: [-1, 0, 0],
};

const TRI: ConstellationPattern = {
  id: "tri",
  name: "Triangulum",
  stars: [{ x: -0.8837, y: -1 }, { x: 0.1887, y: 0.6767 }, { x: 0.6949, y: 0.3233 }],
  parent: [-1, 0, 0],
};

const TRA: ConstellationPattern = {
  id: "tra",
  name: "Triangulum Australe",
  stars: [{ x: 1, y: -0.4256 }, { x: -0.1207, y: 0.7764 }, { x: -0.8793, y: -0.3508 }],
  parent: [-1, 0, 0],
};

const APS: ConstellationPattern = {
  id: "aps",
  name: "Apus",
  stars: [{ x: 0.1808, y: -0.0403 }, { x: -1, y: -0.1301 }, { x: 0.471, y: 0.2625 }, { x: 0.3481, y: -0.0921 }],
  parent: [-1, 0, 0, 2],
};

const ARI: ConstellationPattern = {
  id: "ari",
  name: "Aries",
  stars: [{ x: -0.1076, y: 0.0848 }, { x: 1, y: 0.5109 }, { x: -0.4319, y: -0.2129 }, { x: -0.4606, y: -0.3828 }],
  parent: [-1, 0, 0, 2],
};

const CAE: ConstellationPattern = {
  id: "cae",
  name: "Caelum",
  stars: [{ x: -0.1471, y: -0.3932 }, { x: -0.5136, y: -1 }, { x: -0.0907, y: 0.5335 }, { x: 0.7514, y: 0.8597 }],
  parent: [-1, 0, 0, 2],
};

const MEN: ConstellationPattern = {
  id: "men",
  name: "Mensa",
  stars: [{ x: 0.152, y: -0.6566 }, { x: 1, y: -0.1365 }, { x: -0.6592, y: -0.1967 }, { x: -0.4928, y: 0.9898 }],
  parent: [-1, 0, 0, 2],
};

const NOR: ConstellationPattern = {
  id: "nor",
  name: "Norma",
  stars: [{ x: -0.4504, y: 1 }, { x: 0.7614, y: 0.1658 }, { x: -0.6423, y: -0.4208 }, { x: 0.3313, y: -0.7451 }],
  parent: [-1, 0, 0, 1],
};

const PYX: ConstellationPattern = {
  id: "pyx",
  name: "Pyxis",
  stars: [{ x: 0.183, y: -0.1965 }, { x: -1, y: -0.9308 }, { x: 0.2961, y: 0.1354 }, { x: 0.5209, y: 0.9919 }],
  parent: [-1, 0, 0, 2],
};

const RET: ConstellationPattern = {
  id: "ret",
  name: "Reticulum",
  stars: [{ x: 0.4577, y: -0.1701 }, { x: 0.5437, y: 0.9582 }, { x: -0.8044, y: -1 }, { x: -0.197, y: 0.2119 }],
  parent: [-1, 0, 0, 1],
};

const SGE: ConstellationPattern = {
  id: "sge",
  name: "Sagitta",
  stars: [{ x: 0.0473, y: 0.0548 }, { x: -0.5636, y: -0.129 }, { x: 1, y: 0.3931 }, { x: -0.4838, y: -0.3189 }],
  parent: [-1, 0, 0, 0],
};

const SCL: ConstellationPattern = {
  id: "scl",
  name: "Sculptor",
  stars: [{ x: -0.0926, y: 0.2831 }, { x: 1, y: 0.1924 }, { x: -0.5646, y: -0.0423 }, { x: -0.3428, y: -0.4331 }],
  parent: [-1, 0, 0, 2],
};

const SCT: ConstellationPattern = {
  id: "sct",
  name: "Scutum",
  stars: [{ x: -0.1485, y: 0.1678 }, { x: 0.3972, y: 0.8137 }, { x: -0.4225, y: -1 }, { x: 0.1737, y: 0.0185 }],
  parent: [-1, 0, 0, 1],
};

const SEX: ConstellationPattern = {
  id: "sex",
  name: "Sextans",
  stars: [{ x: -1, y: -0.9134 }, { x: -0.3156, y: 0.4604 }, { x: 0.6398, y: 0.0398 }, { x: 0.6758, y: 0.4132 }],
  parent: [-1, 0, 0, 2],
};

const CNC: ConstellationPattern = {
  id: "cnc",
  name: "Cancer",
  stars: [{ x: 0.0603, y: 0.0246 }, { x: 0.3621, y: -0.5541 }, { x: 0.0297, y: 0.3293 }, { x: -0.5558, y: -0.7998 }, { x: 0.1036, y: 1 }],
  parent: [-1, 0, 0, 0, 2],
};

const CAS: ConstellationPattern = {
  id: "cas",
  name: "Cassiopeia",
  stars: [{ x: 0.4615, y: 0.0262 }, { x: 1, y: 0.5449 }, { x: -0.0869, y: 0.0989 }, { x: -0.3922, y: -0.5323 }, { x: -0.9825, y: -0.1377 }],
  parent: [-1, 0, 0, 2, 3],
};

const CHA: ConstellationPattern = {
  id: "cha",
  name: "Chamaeleon",
  stars: [{ x: -0.0804, y: 0.0135 }, { x: -1, y: 0.245 }, { x: -0.0146, y: -0.2419 }, { x: 0.4847, y: 0.0664 }, { x: 0.6104, y: -0.0831 }],
  parent: [-1, 0, 0, 0, 2],
};

const COL: ConstellationPattern = {
  id: "col",
  name: "Columba",
  stars: [{ x: -0.0513, y: 0.0838 }, { x: 0.9139, y: 0.4424 }, { x: -0.4018, y: 0.3443 }, { x: 0.2023, y: -1 }, { x: -0.6631, y: 0.1296 }],
  parent: [-1, 0, 0, 0, 2],
};

const CRV: ConstellationPattern = {
  id: "crv",
  name: "Corvus",
  stars: [{ x: -0.5039, y: -0.3733 }, { x: -0.5938, y: -0.8477 }, { x: -0.2055, y: 0.7691 }, { x: 0.7704, y: -0.5481 }, { x: 0.5328, y: 1 }],
  parent: [-1, 0, 0, 0, 2],
};

const DEL: ConstellationPattern = {
  id: "del",
  name: "Delphinus",
  stars: [{ x: -0.1872, y: -0.002 }, { x: -0.5052, y: -1 }, { x: -0.034, y: 0.3972 }, { x: 0.2463, y: 0.1433 }, { x: 0.4801, y: 0.4615 }],
  parent: [-1, 0, 0, 0, 2],
};

const GRU: ConstellationPattern = {
  id: "gru",
  name: "Grus",
  stars: [{ x: 0.1561, y: 0.2926 }, { x: 0.3537, y: -0.6027 }, { x: -0.2774, y: 0.926 }, { x: -1, y: 0.2772 }, { x: 0.7675, y: -0.8931 }],
  parent: [-1, 0, 0, 0, 1],
};

const IND: ConstellationPattern = {
  id: "ind",
  name: "Indus",
  stars: [{ x: -0.5731, y: 0.7757 }, { x: -0.4464, y: 0.1701 }, { x: 0.255, y: -0.0298 }, { x: -0.2355, y: -0.6844 }, { x: 1, y: -0.2316 }],
  parent: [-1, 0, 0, 1, 2],
};

const LMI: ConstellationPattern = {
  id: "lmi",
  name: "Leo Minor",
  stars: [{ x: -0.2372, y: -0.0031 }, { x: 0.1875, y: -0.1661 }, { x: 0.2327, y: 0.1615 }, { x: -1, y: 0.1267 }, { x: 0.8169, y: -0.119 }],
  parent: [-1, 0, 0, 0, 1],
};

const MIC: ConstellationPattern = {
  id: "mic",
  name: "Microscopium",
  stars: [{ x: -0.3728, y: 0.382 }, { x: -0.4131, y: -1 }, { x: -0.0651, y: 0.588 }, { x: 0.4638, y: -0.5696 }, { x: 0.3871, y: 0.5996 }],
  parent: [-1, 0, 0, 1, 2],
};

const VOL: ConstellationPattern = {
  id: "vol",
  name: "Volans",
  stars: [{ x: 0.1222, y: -0.1192 }, { x: 1, y: 0.2613 }, { x: 0.4089, y: 0.3057 }, { x: -0.7005, y: -0.0062 }, { x: -0.8307, y: -0.4417 }],
  parent: [-1, 0, 0, 0, 0],
};

const VUL: ConstellationPattern = {
  id: "vul",
  name: "Vulpecula",
  stars: [{ x: -0.595, y: -0.0682 }, { x: -1, y: -0.5374 }, { x: 0.2079, y: -0.152 }, { x: 0.4557, y: 0.3745 }, { x: 0.9314, y: 0.3831 }],
  parent: [-1, 0, 0, 2, 3],
};

const DOR: ConstellationPattern = {
  id: "dor",
  name: "Dorado",
  stars: [{ x: 0.3687, y: -0.4228 }, { x: -0.6178, y: 0.5399 }, { x: 0.5531, y: -0.8425 }, { x: 0.7074, y: -0.5004 }, { x: -0.0964, y: 0.2259 }, { x: -0.9151, y: 1 }],
  parent: [-1, 0, 0, 0, 0, 1],
};

const HOR: ConstellationPattern = {
  id: "hor",
  name: "Horologium",
  stars: [{ x: -0.2546, y: 0.2733 }, { x: 0.8934, y: 1 }, { x: -0.3193, y: 0.1244 }, { x: -0.2784, y: -0.047 }, { x: 0.0097, y: -0.4902 }, { x: -0.0508, y: -0.8605 }],
  parent: [-1, 0, 0, 2, 3, 4],
};

const HYI: ConstellationPattern = {
  id: "hyi",
  name: "Hydrus",
  stars: [{ x: 0.9082, y: -0.5037 }, { x: -1, y: -0.8314 }, { x: 0.2676, y: 0.1456 }, { x: 0.0986, y: 0.1029 }, { x: -0.1554, y: 0.2129 }, { x: -0.119, y: 0.8736 }],
  parent: [-1, 0, 0, 2, 3, 4],
};

const LIB: ConstellationPattern = {
  id: "lib",
  name: "Libra",
  stars: [{ x: -0.6204, y: 0.4047 }, { x: -0.3444, y: -0.4214 }, { x: -0.0737, y: 1 }, { x: 0.3139, y: 0.5166 }, { x: 0.3452, y: -0.6765 }, { x: 0.3794, y: -0.8234 }],
  parent: [-1, 0, 0, 0, 3, 4],
};

const LYR: ConstellationPattern = {
  id: "lyr",
  name: "Lyra",
  stars: [{ x: -0.1848, y: 0.2927 }, { x: -0.2056, y: 0.8207 }, { x: -0.5989, y: 0.6027 }, { x: 0.3296, y: 0.1069 }, { x: 0.0957, y: -0.823 }, { x: 0.5642, y: -1 }],
  parent: [-1, 0, 0, 0, 0, 3],
};

const MUS: ConstellationPattern = {
  id: "mus",
  name: "Musca",
  stars: [{ x: 0.1558, y: 0.0338 }, { x: -0.2837, y: 0.3314 }, { x: 0.3597, y: 0.294 }, { x: 0.0501, y: -0.7252 }, { x: -1, y: 0.6433 }, { x: 0.718, y: -0.5773 }],
  parent: [-1, 0, 0, 0, 1, 2],
};

const PHE: ConstellationPattern = {
  id: "phe",
  name: "Phoenix",
  stars: [{ x: 0.1593, y: 0.042 }, { x: -0.6548, y: 0.5721 }, { x: 0.6151, y: 0.4505 }, { x: 0.2064, y: -0.9824 }, { x: -1, y: 0.1587 }, { x: 0.6741, y: -0.2408 }],
  parent: [-1, 0, 0, 0, 0, 2],
};

const SER_2: ConstellationPattern = {
  id: "ser-2",
  name: "Serpens (2)",
  stars: [{ x: -0.4309, y: -0.5466 }, { x: -0.9261, y: -0.5706 }, { x: -0.0408, y: -0.1331 }, { x: 0.033, y: -0.016 }, { x: 0.3647, y: 0.3721 }, { x: 1, y: 0.8942 }],
  parent: [-1, 0, 0, 2, 3, 4],
};

const TUC: ConstellationPattern = {
  id: "tuc",
  name: "Tucana",
  stars: [{ x: -1, y: 0.3164 }, { x: -0.1657, y: 0.5672 }, { x: -0.875, y: -0.267 }, { x: 0.8836, y: -0.0181 }, { x: 0.4358, y: -0.3427 }, { x: 0.7212, y: -0.2557 }],
  parent: [-1, 0, 0, 1, 2, 3],
};

const ARA: ConstellationPattern = {
  id: "ara",
  name: "Ara",
  stars: [{ x: 0.3927, y: -0.8218 }, { x: 0.2576, y: -0.096 }, { x: -0.5857, y: -0.545 }, { x: -0.3765, y: -0.0306 }, { x: -0.3537, y: 0.4464 }, { x: 0.4103, y: 1 }, { x: 0.2553, y: 0.047 }],
  parent: [-1, 0, 0, 2, 3, 4, 5],
};

const CRB: ConstellationPattern = {
  id: "crb",
  name: "Corona Borealis",
  stars: [{ x: -0.9086, y: 0.2745 }, { x: -0.6189, y: 0.8543 }, { x: -0.5191, y: -0.3407 }, { x: -0.0618, y: -0.4486 }, { x: 0.3272, y: -0.507 }, { x: 0.7811, y: -0.2988 }, { x: 1, y: 0.4663 }],
  parent: [-1, 0, 0, 2, 3, 4, 5],
};

const LYN: ConstellationPattern = {
  id: "lyn",
  name: "Lynx",
  stars: [{ x: -0.6484, y: 0.6631 }, { x: -1, y: 0.6948 }, { x: -0.3735, y: 0.1668 }, { x: 0.1506, y: -0.1578 }, { x: 0.5036, y: -0.2335 }, { x: 0.6736, y: -0.5018 }, { x: 0.6942, y: -0.6317 }],
  parent: [-1, 0, 0, 2, 3, 4, 5],
};

const UMI: ConstellationPattern = {
  id: "umi",
  name: "Ursa Minor",
  stars: [{ x: -0.206, y: -0.0761 }, { x: -0.1438, y: -0.1604 }, { x: -0.3054, y: -0.2267 }, { x: -0.0908, y: 0.0995 }, { x: -0.2495, y: -0.3227 }, { x: -0.0047, y: 0.2878 }, { x: 1, y: 0.3986 }],
  parent: [-1, 0, 0, 0, 1, 3, 5],
};

const AQL: ConstellationPattern = {
  id: "aql",
  name: "Aquila",
  stars: [{ x: 0.2999, y: 0.4244 }, { x: 0.1832, y: 0.6052 }, { x: 0.4168, y: 0.1694 }, { x: -0.3526, y: -0.1716 }, { x: -0.871, y: 0.9419 }, { x: 0.8295, y: -0.5793 }, { x: 0.3435, y: -0.39 }, { x: -0.8494, y: -1 }],
  parent: [-1, 0, 0, 0, 0, 2, 3, 3],
};

const CAM: ConstellationPattern = {
  id: "cam",
  name: "Camelopardalis",
  stars: [{ x: -0.0102, y: 0.0686 }, { x: 0.0649, y: -0.3869 }, { x: -0.5208, y: 0.4537 }, { x: 0.6695, y: 0.2984 }, { x: 0.0157, y: -0.9033 }, { x: -0.5275, y: 0.0056 }, { x: 1, y: 0.8895 }, { x: -0.6915, y: -0.4256 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 5],
};

const CRA: ConstellationPattern = {
  id: "cra",
  name: "Corona Australis",
  stars: [{ x: 0.247, y: 0.5746 }, { x: -0.0446, y: 0.5659 }, { x: 0.3627, y: 0.4083 }, { x: 0.3838, y: 0.1243 }, { x: 0.3201, y: -0.1043 }, { x: 0.1218, y: -0.4203 }, { x: -0.3908, y: -0.6851 }, { x: -1, y: -0.4633 }],
  parent: [-1, 0, 0, 2, 3, 4, 5, 6],
};

const PSA: ConstellationPattern = {
  id: "psa",
  name: "Piscis Austrinus",
  stars: [{ x: -0.4482, y: -0.1734 }, { x: 0.3117, y: 0.4827 }, { x: 0.0962, y: -0.1025 }, { x: -1, y: -0.1775 }, { x: -0.9343, y: 0.0573 }, { x: 0.7118, y: 0.1981 }, { x: 0.5911, y: -0.1609 }, { x: 0.6717, y: -0.1238 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 5],
};

const SER: ConstellationPattern = {
  id: "ser",
  name: "Serpens",
  stars: [{ x: -0.0585, y: 0.3161 }, { x: -0.1368, y: 0.6086 }, { x: 0.1151, y: 0.3326 }, { x: -0.2509, y: -0.0201 }, { x: -0.0153, y: 0.5034 }, { x: -0.0909, y: -0.3033 }, { x: 0.0198, y: -0.4374 }, { x: 0.4176, y: -1 }],
  parent: [-1, 0, 0, 0, 1, 3, 5, 6],
};

const VEL: ConstellationPattern = {
  id: "vel",
  name: "Vela",
  stars: [{ x: -0.0887, y: -0.5012 }, { x: -0.5584, y: -0.4783 }, { x: 0.3476, y: -0.4677 }, { x: 0.9742, y: -0.0784 }, { x: 0.572, y: 0.4735 }, { x: 0.0191, y: 0.5986 }, { x: -0.2659, y: 0.3744 }, { x: -1, y: 0.0791 }],
  parent: [-1, 0, 0, 2, 3, 4, 5, 6],
};

const AUR: ConstellationPattern = {
  id: "aur",
  name: "Auriga",
  stars: [{ x: -0.1266, y: 0.3691 }, { x: 0.4874, y: 0.2891 }, { x: -0.272, y: 0.0065 }, { x: 0.4873, y: 1 }, { x: -0.3376, y: 0.2035 }, { x: 0.4901, y: -0.2998 }, { x: -0.4089, y: -0.6078 }, { x: -0.3307, y: -0.0057 }, { x: 0.011, y: -0.9549 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 4, 5],
};

const CRT: ConstellationPattern = {
  id: "crt",
  name: "Crater",
  stars: [{ x: -0.2548, y: 0.2462 }, { x: -0.0745, y: 0.8056 }, { x: -0.9242, y: -0.2563 }, { x: -0.0652, y: -0.1685 }, { x: 0.3385, y: 0.9565 }, { x: -0.5176, y: -0.9024 }, { x: -0.1171, y: -0.325 }, { x: 0.615, y: -0.2637 }, { x: 1, y: -0.0924 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 3, 7],
};

const CYG: ConstellationPattern = {
  id: "cyg",
  name: "Cygnus",
  stars: [{ x: 0.2249, y: -0.0059 }, { x: 0.5755, y: -0.4882 }, { x: -0.3198, y: 0.368 }, { x: 0.5057, y: 0.3795 }, { x: -0.1541, y: -0.4028 }, { x: 0.9663, y: -0.7754 }, { x: -0.543, y: 0.8743 }, { x: -0.5282, y: -0.9494 }, { x: -0.7273, y: 1 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 4, 6],
};

const LAC: ConstellationPattern = {
  id: "lac",
  name: "Lacerta",
  stars: [{ x: 0.0857, y: 0.256 }, { x: 0.1245, y: 0.5809 }, { x: -0.1017, y: 0.1084 }, { x: 0.3277, y: -0.1767 }, { x: -0.0248, y: 0.4792 }, { x: -0.0459, y: 0.8264 }, { x: 0.1068, y: -0.3221 }, { x: -0.2592, y: -0.752 }, { x: -0.2131, y: -1 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 6, 7],
};

const LEO: ConstellationPattern = {
  id: "leo",
  name: "Leo",
  stars: [{ x: -0.1567, y: 0.0384 }, { x: -0.3209, y: -0.1309 }, { x: 0.5462, y: 0.0759 }, { x: -0.1993, y: 0.2349 }, { x: -0.3074, y: -0.3946 }, { x: 1, y: -0.2513 }, { x: -0.51, y: 0.3773 }, { x: 0.5479, y: -0.2042 }, { x: -0.5998, y: 0.2546 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 4, 6],
};

const MON: ConstellationPattern = {
  id: "mon",
  name: "Monoceros",
  stars: [{ x: 0.2339, y: -0.014 }, { x: 1, y: -0.1486 }, { x: -0.3474, y: -0.3673 }, { x: -0.0902, y: 0.1429 }, { x: 0.6307, y: -0.5033 }, { x: -0.536, y: -0.3263 }, { x: -0.4156, y: 0.2607 }, { x: -0.2922, y: 0.4087 }, { x: -0.1832, y: 0.5472 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 6, 7],
};

const CAP: ConstellationPattern = {
  id: "cap",
  name: "Capricornus",
  stars: [{ x: -0.9308, y: 0.5606 }, { x: -0.8582, y: 0.3533 }, { x: 0.1124, y: 0.1298 }, { x: -0.6886, y: 0.0768 }, { x: 0.4645, y: 0.1661 }, { x: -0.3164, y: -0.6032 }, { x: 0.8499, y: 0.1818 }, { x: -0.1927, y: -0.7535 }, { x: 1, y: 0.2306 }, { x: 0.5599, y: -0.3424 }],
  parent: [-1, 0, 0, 1, 2, 3, 4, 5, 6, 7],
};

const CEP: ConstellationPattern = {
  id: "cep",
  name: "Cepheus",
  stars: [{ x: -0.2865, y: -0.0591 }, { x: -0.5485, y: -0.1117 }, { x: -0.0902, y: -0.327 }, { x: -0.2071, y: 0.5022 }, { x: -0.6722, y: -0.0303 }, { x: 0.158, y: -0.4492 }, { x: 0.4307, y: 0.1953 }, { x: 0.8217, y: 1 }, { x: 0.125, y: -0.3677 }, { x: 0.2692, y: -0.3526 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 3, 5, 6],
};

const PAV: ConstellationPattern = {
  id: "pav",
  name: "Pavo",
  stars: [{ x: 0.65, y: -0.0892 }, { x: 0.4871, y: 0.6694 }, { x: 0.3443, y: -0.0875 }, { x: 0.2757, y: -0.6266 }, { x: 1, y: -0.0221 }, { x: -0.3012, y: 0.2325 }, { x: -0.3787, y: -0.5078 }, { x: -0.5458, y: 0.2881 }, { x: -0.8621, y: 0.0293 }, { x: -0.6693, y: 0.1139 }],
  parent: [-1, 0, 0, 0, 0, 2, 3, 5, 6, 7],
};

const CMA: ConstellationPattern = {
  id: "cma",
  name: "Canis Maior",
  stars: [{ x: -0.2067, y: 0.5466 }, { x: -0.7099, y: 0.4264 }, { x: 0.1939, y: -0.1434 }, { x: 0.0395, y: 0.5138 }, { x: 0.3142, y: -0.3915 }, { x: 0.2104, y: 0.6515 }, { x: -0.0041, y: 1 }, { x: 0.1647, y: -0.541 }, { x: 0.6662, y: -0.6736 }, { x: 0.0953, y: -0.6415 }, { x: -0.7634, y: -0.7473 }],
  parent: [-1, 0, 0, 0, 2, 3, 3, 4, 4, 7, 9],
};

const LEP: ConstellationPattern = {
  id: "lep",
  name: "Lepus",
  stars: [{ x: -0.6716, y: 0.1468 }, { x: -0.0498, y: -0.066 }, { x: -0.9063, y: -0.6646 }, { x: -0.6622, y: 0.5763 }, { x: -0.463, y: 0.5453 }, { x: 0.397, y: 0.3288 }, { x: -0.1907, y: -0.4525 }, { x: 0.6938, y: 0.4149 }, { x: 0.3187, y: -0.6748 }, { x: 1, y: 0.3139 }, { x: 0.5341, y: -0.4683 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 5, 6, 7, 8],
};

const PUP: ConstellationPattern = {
  id: "pup",
  name: "Puppis",
  stars: [{ x: -0.0977, y: 0.2204 }, { x: -0.3471, y: -0.3412 }, { x: -0.0506, y: 0.3211 }, { x: 0.0175, y: 0.1827 }, { x: -0.8855, y: -0.7336 }, { x: 0.0925, y: 0.4462 }, { x: 0.076, y: 0.3769 }, { x: 0.1959, y: 0.5736 }, { x: 0.342, y: 0.482 }, { x: 0.2879, y: -0.5281 }, { x: 0.3692, y: -1 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 5, 7, 8, 9],
};

const BOO: ConstellationPattern = {
  id: "boo",
  name: "Bootes",
  stars: [{ x: -0.1373, y: -0.6735 }, { x: -0.3643, y: -0.7137 }, { x: 0.0377, y: -0.1003 }, { x: 0.1801, y: -0.2692 }, { x: 0.1386, y: -0.9529 }, { x: -0.4446, y: -0.7619 }, { x: 0.0404, y: 0.3063 }, { x: 0.5103, y: 0.0505 }, { x: 0.3636, y: 0.4129 }, { x: -0.1294, y: 0.7048 }, { x: -0.161, y: 0.9968 }, { x: -0.0341, y: 1 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 3, 6, 6, 9, 9],
};

const GEM: ConstellationPattern = {
  id: "gem",
  name: "Gemini",
  stars: [{ x: 0.3604, y: -0.0891 }, { x: 0.6898, y: 0.3559 }, { x: 0.0265, y: -0.217 }, { x: 0.318, y: -0.5821 }, { x: 0.8856, y: 0.4583 }, { x: -0.5239, y: -0.5948 }, { x: 0.6622, y: 0.8082 }, { x: -0.3659, y: -0.9122 }, { x: 0.1731, y: 0.6593 }, { x: -0.3942, y: 0.1961 }, { x: -0.8315, y: -0.041 }, { x: -1, y: -0.0416 }],
  parent: [-1, 0, 0, 0, 1, 2, 4, 5, 6, 8, 9, 10],
};

const LUP: ConstellationPattern = {
  id: "lup",
  name: "Lupus",
  stars: [{ x: -0.1068, y: 0.0678 }, { x: -0.0992, y: 0.4768 }, { x: -0.5063, y: -0.164 }, { x: 0.1341, y: 0.0194 }, { x: 0.215, y: 0.6493 }, { x: -0.7968, y: -0.5607 }, { x: -0.0839, y: -0.3091 }, { x: 0.5711, y: 0.2777 }, { x: 0.4108, y: 0.7225 }, { x: -0.2658, y: -1 }, { x: -0.1564, y: -0.6061 }, { x: 0.6843, y: 0.4264 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 3, 4, 5, 6, 7],
};

const TAU: ConstellationPattern = {
  id: "tau",
  name: "Taurus",
  stars: [{ x: 0.0053, y: 0.0677 }, { x: 0.1186, y: 0.0806 }, { x: 0.0454, y: 0.1687 }, { x: -0.2389, y: -0.0978 }, { x: 0.2113, y: 0.1142 }, { x: 0.118, y: 0.2552 }, { x: -0.6633, y: -0.2385 }, { x: 1, y: 0.3587 }, { x: 0.8549, y: 0.7525 }, { x: -0.2073, y: -0.4407 }, { x: -0.701, y: -0.2851 }, { x: -0.5431, y: -0.7355 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 6, 10],
};

const VIR: ConstellationPattern = {
  id: "vir",
  name: "Virgo",
  stars: [{ x: -0.3834, y: -0.0471 }, { x: -0.6238, y: -0.0125 }, { x: -0.0708, y: -0.2279 }, { x: -0.2294, y: 0.1671 }, { x: -0.9466, y: 0.0949 }, { x: 0.0976, y: -0.4764 }, { x: 0.2025, y: -0.0094 }, { x: -0.1567, y: 0.5013 }, { x: -1, y: 0.3055 }, { x: 0.6591, y: -0.2483 }, { x: 0.5004, y: 0.0852 }, { x: 0.958, y: -0.2331 }, { x: 0.9932, y: 0.1006 }],
  parent: [-1, 0, 0, 0, 1, 2, 2, 3, 4, 5, 6, 9, 10],
};

const CET: ConstellationPattern = {
  id: "cet",
  name: "Cetus",
  stars: [{ x: 0.3869, y: 0.2178 }, { x: 0.3154, y: 0.3088 }, { x: 0.5699, y: 0.2507 }, { x: 0.3501, y: 0.1056 }, { x: 0.241, y: 0.4194 }, { x: 0.5452, y: 0.4367 }, { x: 0.156, y: -0.022 }, { x: 0.4028, y: 0.4832 }, { x: -0.1128, y: -0.306 }, { x: -0.1841, y: -0.5222 }, { x: -0.3773, y: -0.2229 }, { x: -0.7671, y: -0.6013 }, { x: -0.5261, y: -0.3001 }, { x: -1, y: -0.2477 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 4, 6, 8, 8, 9, 10, 11],
};

const PEG: ConstellationPattern = {
  id: "peg",
  name: "Pegasus",
  stars: [{ x: 0.2229, y: 0.3551 }, { x: -0.0095, y: 0.4574 }, { x: 0.9458, y: 0.4033 }, { x: 0.2339, y: -0.2607 }, { x: 0.0689, y: 0.1887 }, { x: -0.3788, y: 0.5988 }, { x: 1, y: -0.2618 }, { x: 0.0318, y: -0.4057 }, { x: 0.03, y: 0.1391 }, { x: -0.0267, y: -0.4699 }, { x: -0.4121, y: 0.2242 }, { x: -0.3764, y: -0.6915 }, { x: -0.6623, y: 0.2386 }, { x: -0.6675, y: -0.5156 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 3, 4, 7, 8, 9, 10, 11],
};

const SCO: ConstellationPattern = {
  id: "sco",
  name: "Scorpius",
  stars: [{ x: -0.7932, y: 0.7911 }, { x: -0.8162, y: 0.532 }, { x: -0.7141, y: 1 }, { x: -0.4698, y: 0.5706 }, { x: -0.3424, y: 0.5084 }, { x: -0.242, y: 0.376 }, { x: -0.0206, y: -0.0748 }, { x: 0.0059, y: -0.3534 }, { x: 0.048, y: -0.6734 }, { x: 0.3204, y: -0.7385 }, { x: 0.7106, y: -0.7206 }, { x: 0.8697, y: -0.5077 }, { x: 0.7907, y: -0.4263 }, { x: 0.653, y: -0.2834 }],
  parent: [-1, 0, 0, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
};

const AQR: ConstellationPattern = {
  id: "aqr",
  name: "Aquarius",
  stars: [{ x: 0.5631, y: -0.044 }, { x: 0.3, y: 0.0233 }, { x: 0.4751, y: -0.5481 }, { x: 0.6158, y: -0.5031 }, { x: 0.8114, y: -0.407 }, { x: 0.1204, y: 0.3371 }, { x: 0.0525, y: 0.3412 }, { x: -0.0221, y: 0.2837 }, { x: 0.0155, y: 0.3999 }, { x: -0.1873, y: 0.3286 }, { x: -0.5434, y: 0.1078 }, { x: -0.0723, y: 0.0148 }, { x: -0.9464, y: -0.0349 }, { x: -0.1805, y: -0.2411 }, { x: -1.0018, y: -0.058 }],
  parent: [-1, 0, 0, 0, 0, 1, 5, 6, 6, 7, 9, 9, 10, 10, 12],
};

const DRA: ConstellationPattern = {
  id: "dra",
  name: "Draco",
  stars: [{ x: 0.2425, y: -0.1781 }, { x: 0.2525, y: -0.3327 }, { x: 0.1734, y: -0.2269 }, { x: 0.4995, y: 0.1318 }, { x: 0.1674, y: -0.3094 }, { x: 0.3308, y: 0.2274 }, { x: 0.6153, y: 0.2066 }, { x: 0.097, y: 0.0759 }, { x: 0.3322, y: 0.2874 }, { x: -0.0486, y: -0.0448 }, { x: -0.1205, y: -0.1295 }, { x: -0.2407, y: -0.1179 }, { x: -0.5026, y: 0.0374 }, { x: -0.7981, y: 0.1929 }, { x: -1, y: 0.1797 }],
  parent: [-1, 0, 0, 0, 1, 3, 3, 5, 5, 7, 9, 10, 11, 12, 13],
};

const CEN: ConstellationPattern = {
  id: "cen",
  name: "Centaurus",
  stars: [{ x: 0.1658, y: -0.2411 }, { x: -0.3242, y: -0.0117 }, { x: 0.2971, y: 0.0734 }, { x: 0.6669, y: -0.6163 }, { x: 0.3667, y: -0.5926 }, { x: -0.4373, y: -0.0764 }, { x: 0.2477, y: 0.3085 }, { x: -0.6025, y: -0.1014 }, { x: -0.5749, y: -0.1852 }, { x: 0.2462, y: 0.3685 }, { x: -1, y: -0.2932 }, { x: -0.9097, y: -0.5453 }, { x: 0.3907, y: 0.6292 }, { x: 0.0038, y: 0.6118 }, { x: 0.6326, y: 0.3346 }, { x: 0.8312, y: 0.3373 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 5, 5, 6, 7, 8, 9, 9, 12, 14],
};

const OPH: ConstellationPattern = {
  id: "oph",
  name: "Ophiuchus",
  stars: [{ x: -0.2391, y: -0.0644 }, { x: -0.0061, y: 0.8534 }, { x: -0.4531, y: 0.206 }, { x: 0.1382, y: -0.3018 }, { x: -0.3075, y: -0.3427 }, { x: 0.4172, y: 1 }, { x: -0.31, y: 0.5132 }, { x: -0.4982, y: 0.2519 }, { x: 0.5142, y: 0.6321 }, { x: 0.2704, y: -0.7287 }, { x: -0.3542, y: -0.4275 }, { x: 0.5644, y: 0.5465 }, { x: 0.3311, y: -0.9527 }, { x: -0.3874, y: -0.5003 }, { x: 0.6908, y: -0.0279 }, { x: -0.3706, y: -0.6572 }],
  parent: [-1, 0, 0, 0, 0, 1, 1, 2, 3, 3, 4, 8, 9, 10, 11, 13],
};

const AND: ConstellationPattern = {
  id: "and",
  name: "Andromeda",
  stars: [{ x: 0.0705, y: -0.4014 }, { x: 0.4047, y: -0.1357 }, { x: -0.2695, y: -0.5003 }, { x: 0.0621, y: -0.4879 }, { x: 0.0436, y: -0.2418 }, { x: 1, y: 0.2388 }, { x: 0.2621, y: 0.025 }, { x: 0.1586, y: -0.7695 }, { x: -0.602, y: 0.2912 }, { x: 0.1858, y: 0.169 }, { x: 0.267, y: -0.8169 }, { x: -1, y: 0.2386 }, { x: -0.577, y: 0.3507 }, { x: 0.4022, y: 0.5131 }, { x: -0.6083, y: 0.4693 }, { x: -0.5152, y: 0.4672 }, { x: 0.7153, y: 0.5905 }],
  parent: [-1, 0, 0, 0, 0, 1, 1, 3, 4, 6, 7, 8, 8, 9, 12, 12, 13],
};

const CAR: ConstellationPattern = {
  id: "car",
  name: "Carina",
  stars: [{ x: 0.3786, y: -0.2304 }, { x: 0.223, y: -0.4622 }, { x: 0.3204, y: -0.1191 }, { x: 0.4934, y: -0.1687 }, { x: -0.0992, y: -0.449 }, { x: 0.2409, y: -0.1045 }, { x: 0.4347, y: -0.0027 }, { x: 0.5239, y: -0.1171 }, { x: -1, y: 0.2503 }, { x: -0.0785, y: -0.02 }, { x: 0.5137, y: -0.0048 }, { x: 0.5393, y: -0.0591 }, { x: -0.9265, y: 0.6406 }, { x: -0.3689, y: -0.0297 }, { x: -0.2508, y: 0.1676 }, { x: -0.5059, y: 0.2385 }, { x: -0.438, y: 0.4705 }],
  parent: [-1, 0, 0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 9, 13, 14],
};

const HER: ConstellationPattern = {
  id: "her",
  name: "Hercules",
  stars: [{ x: -0.3498, y: -0.6104 }, { x: -0.4458, y: -0.7386 }, { x: -0.2219, y: -0.0554 }, { x: 0.1636, y: -1 }, { x: -0.2033, y: 0.3463 }, { x: -0.0023, y: -0.0925 }, { x: -0.305, y: 0.5392 }, { x: 0.1682, y: 0.2304 }, { x: 0.1681, y: -0.4266 }, { x: -0.4709, y: 0.752 }, { x: 0.268, y: 0.2488 }, { x: 0.5313, y: -0.2684 }, { x: -0.5977, y: 0.6763 }, { x: 0.6445, y: 0.2546 }, { x: 0.6619, y: -0.1846 }, { x: -0.7837, y: 0.54 }, { x: 0.7749, y: -0.2112 }],
  parent: [-1, 0, 0, 0, 2, 2, 4, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14],
};

const HYA: ConstellationPattern = {
  id: "hya",
  name: "Hydra",
  stars: [{ x: -0.3829, y: 0.2886 }, { x: -0.3454, y: 0.2057 }, { x: -0.4394, y: 0.2657 }, { x: -0.3285, y: 0.2632 }, { x: -0.3974, y: 0.1574 }, { x: -0.4043, y: 0.217 }, { x: -0.2719, y: 0.19 }, { x: -0.1754, y: 0.1368 }, { x: -0.2219, y: 0.0212 }, { x: -0.1314, y: -0.074 }, { x: -0.0591, y: -0.0357 }, { x: -0.0004, y: -0.1046 }, { x: 0.0888, y: -0.0947 }, { x: 0.253, y: -0.3356 }, { x: 0.3284, y: -0.3672 }, { x: 0.654, y: -0.202 }, { x: 0.8337, y: -0.256 }, { x: 1, y: -0.2757 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
};

const UMA: ConstellationPattern = {
  id: "uma",
  name: "Ursa Maior",
  stars: [{ x: 0.0472, y: 0.2061 }, { x: 0.058, y: 0.4011 }, { x: 0.3461, y: 0.1085 }, { x: -0.3602, y: 0.3026 }, { x: -0.3538, y: 0.1219 }, { x: 0.4703, y: 0.2298 }, { x: -0.4721, y: 0.4487 }, { x: 0.3014, y: -0.1063 }, { x: -0.8244, y: 0.3636 }, { x: -0.4645, y: 0.0353 }, { x: 0.6923, y: 0.1908 }, { x: 0.1429, y: -0.6381 }, { x: 0.0922, y: -0.2255 }, { x: -0.6639, y: -0.0893 }, { x: -0.6267, y: -0.1364 }, { x: 0.8642, y: 0.1532 }, { x: 0.1411, y: -0.6981 }, { x: -0.1799, y: -0.3346 }, { x: -0.2102, y: -0.2828 }, { x: 1, y: -0.0506 }],
  parent: [-1, 0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 7, 7, 9, 9, 10, 11, 12, 12, 15],
};

const PSC: ConstellationPattern = {
  id: "psc",
  name: "Pisces",
  stars: [{ x: 0.3707, y: 0.6512 }, { x: 0.3487, y: 0.8868 }, { x: 0.431, y: 0.7659 }, { x: 0.3465, y: 0.4994 }, { x: 0.5579, y: 0.256 }, { x: 0.7047, y: -0.0088 }, { x: 0.8804, y: -0.2824 }, { x: 0.7908, y: -0.2642 }, { x: 0.6629, y: -0.1658 }, { x: 0.5442, y: -0.1377 }, { x: 0.3705, y: -0.0765 }, { x: 0.2567, y: -0.063 }, { x: 0.1061, y: -0.0761 }, { x: -0.4149, y: -0.1069 }, { x: -0.6193, y: -0.1599 }, { x: -0.7457, y: -0.1277 }, { x: -0.5513, y: -0.2514 }, { x: -0.8262, y: -0.1704 }, { x: -0.5971, y: -0.3244 }, { x: -0.8597, y: -0.2602 }, { x: -0.7567, y: -0.3469 }, { x: -1, y: -0.2372 }],
  parent: [-1, 0, 0, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14, 15, 16, 17, 18, 19],
};

const ORI: ConstellationPattern = {
  id: "ori",
  name: "Orion",
  stars: [{ x: 0.434, y: 0.029 }, { x: 0.5419, y: 0.164 }, { x: -0.0152, y: -0.0347 }, { x: 0.1345, y: 0.1812 }, { x: 0.2185, y: -0.5344 }, { x: 0.6848, y: 0.4388 }, { x: -0.4673, y: 0.1943 }, { x: 0.0876, y: -0.4354 }, { x: 0.3231, y: -1 }, { x: 0.1505, y: -0.4898 }, { x: 0.5648, y: 0.7961 }, { x: -0.5314, y: 0.1189 }, { x: -0.4453, y: 0.397 }, { x: -0.025, y: -0.5618 }, { x: 0.4222, y: 0.8044 }, { x: -0.5429, y: 0.0021 }, { x: -0.3227, y: 0.5108 }, { x: -0.1736, y: -0.9115 }, { x: 0.6195, y: 0.4725 }, { x: -0.5225, y: -0.0796 }, { x: -0.246, y: 0.5225 }, { x: -0.477, y: -0.2703 }, { x: -0.4127, y: -0.3141 }],
  parent: [-1, 0, 0, 0, 0, 1, 2, 2, 4, 4, 5, 6, 6, 7, 10, 11, 12, 13, 14, 15, 16, 19, 21],
};

const PER: ConstellationPattern = {
  id: "per",
  name: "Perseus",
  stars: [{ x: 0.2087, y: 0.168 }, { x: 0.2317, y: -0.1298 }, { x: 0.1435, y: 0.1912 }, { x: 0.4696, y: 0.1638 }, { x: 0.36, y: -0.2767 }, { x: 0.0202, y: 0.2866 }, { x: 0.5328, y: 0.2036 }, { x: 0.3713, y: -0.5179 }, { x: -0.1777, y: 0.4951 }, { x: 0.4485, y: 0.3146 }, { x: 0.3223, y: -0.7414 }, { x: -0.3206, y: 0.6317 }, { x: 0.2229, y: -0.7182 }, { x: -0.2845, y: 0.4525 }, { x: -0.1344, y: 0.2724 }, { x: -0.1301, y: 0.0005 }, { x: -0.3864, y: 0.2504 }, { x: -0.1435, y: -0.2226 }, { x: -1, y: 0.3339 }, { x: -0.1119, y: -0.2995 }, { x: -0.2297, y: -0.2182 }, { x: -0.1738, y: -0.3436 }, { x: -0.2389, y: -0.2965 }],
  parent: [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 13, 14, 14, 15, 16, 17, 17, 19, 20],
};

const SGR: ConstellationPattern = {
  id: "sgr",
  name: "Sagittarius",
  stars: [{ x: -0.1167, y: 0.0805 }, { x: -0.2433, y: 0.0392 }, { x: 0.1504, y: 0.1424 }, { x: 0.0371, y: -0.0012 }, { x: 0.0074, y: 0.3515 }, { x: -0.1311, y: 0.2918 }, { x: -0.5682, y: -0.1296 }, { x: -0.4763, y: 0.1326 }, { x: -0.0199, y: -0.1327 }, { x: 0.2787, y: 0.1869 }, { x: 0.0743, y: 0.3942 }, { x: -0.0842, y: 0.3893 }, { x: -0.5263, y: -0.4006 }, { x: -0.7683, y: -0.165 }, { x: -0.6635, y: 0.3921 }, { x: 0.2604, y: -0.7714 }, { x: 0.4293, y: 0.1646 }, { x: 0.178, y: 0.5174 }, { x: -0.6126, y: -0.5421 }, { x: 0.2439, y: -1 }, { x: 0.6813, y: 0.0804 }, { x: 0.2312, y: 0.5832 }, { x: 0.7327, y: -0.4537 }, { x: 0.2319, y: 0.6958 }, { x: 0.6737, y: -0.8459 }],
  parent: [-1, 0, 0, 0, 0, 0, 1, 1, 1, 2, 4, 4, 6, 6, 7, 8, 9, 10, 12, 15, 16, 17, 20, 21, 22],
};

const ERI: ConstellationPattern = {
  id: "eri",
  name: "Eridanus",
  stars: [{ x: 0.5533, y: 0.7263 }, { x: 0.7139, y: 0.6677 }, { x: 0.4873, y: 0.7232 }, { x: 0.3115, y: 0.6117 }, { x: 0.2121, y: 0.3984 }, { x: 0.1266, y: 0.4434 }, { x: 0.1058, y: 0.5182 }, { x: 0.0317, y: 0.5279 }, { x: -0.2307, y: 0.5458 }, { x: -0.3191, y: 0.3872 }, { x: -0.3121, y: 0.2365 }, { x: -0.1878, y: 0.0749 }, { x: -0.0647, y: 0.1346 }, { x: 0.0378, y: 0.1386 }, { x: 0.1317, y: 0.0869 }, { x: 0.4818, y: -0.147 }, { x: 0.4066, y: -0.2586 }, { x: 0.3473, y: -0.2493 }, { x: 0.1504, y: -0.3273 }, { x: 0.0616, y: -0.4576 }, { x: -0.0618, y: -0.5469 }, { x: -0.2175, y: -0.4585 }, { x: -0.344, y: -0.4442 }, { x: -0.4423, y: -0.6951 }, { x: -0.5176, y: -0.8169 }, { x: -0.6653, y: -0.82 }, { x: -0.7965, y: -1 }],
  parent: [-1, 0, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
};

/**
 * Every shippable pattern, sourced from real constellation data (see file header) — sorted by
 * star count ascending (asserted by the test suite) so small vaults preferentially match small
 * patterns first when scanning for candidates. See docs/CONSTELLATION.md's "Named patterns".
 */
export const PATTERNS: ConstellationPattern[] = [
  ANT,
  CIR,
  COM,
  EQU,
  FOR,
  OCT,
  PIC,
  TEL,
  TRI,
  TRA,
  APS,
  ARI,
  CAE,
  MEN,
  NOR,
  PYX,
  RET,
  SGE,
  SCL,
  SCT,
  SEX,
  CNC,
  CAS,
  CHA,
  COL,
  CRV,
  DEL,
  GRU,
  IND,
  LMI,
  MIC,
  VOL,
  VUL,
  DOR,
  HOR,
  HYI,
  LIB,
  LYR,
  MUS,
  PHE,
  SER_2,
  TUC,
  ARA,
  CRB,
  LYN,
  UMI,
  AQL,
  CAM,
  CRA,
  PSA,
  SER,
  VEL,
  AUR,
  CRT,
  CYG,
  LAC,
  LEO,
  MON,
  CAP,
  CEP,
  PAV,
  CMA,
  LEP,
  PUP,
  BOO,
  GEM,
  LUP,
  TAU,
  VIR,
  CET,
  PEG,
  SCO,
  AQR,
  DRA,
  CEN,
  OPH,
  AND,
  CAR,
  HER,
  HYA,
  UMA,
  PSC,
  ORI,
  PER,
  SGR,
  ERI,
].sort((a, b) => a.stars.length - b.stars.length);

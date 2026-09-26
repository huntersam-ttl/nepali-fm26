import type { PackGeography } from "../country-pack.js";

/*
 * Nepal's administrative geography as pack data: the seven provinces and 77 districts a new save
 * is guaranteed to have (the imported dataset only carries the places its clubs sit in), and the
 * places Nepal's football uses for territorial development and for a plausible club address.
 */

const PROVINCE_DISTRICTS: Array<[string, string[]]> = [
  [
    "Koshi",
    [
      "Taplejung",
      "Panchthar",
      "Ilam",
      "Jhapa",
      "Morang",
      "Sunsari",
      "Dhankuta",
      "Terhathum",
      "Sankhuwasabha",
      "Bhojpur",
      "Solukhumbu",
      "Okhaldhunga",
      "Khotang",
      "Udayapur",
    ],
  ],
  [
    "Madhesh",
    ["Saptari", "Siraha", "Dhanusha", "Mahottari", "Sarlahi", "Rautahat", "Bara", "Parsa"],
  ],
  [
    "Bagmati",
    [
      "Dolakha",
      "Ramechhap",
      "Sindhuli",
      "Kavrepalanchok",
      "Sindhupalchok",
      "Rasuwa",
      "Nuwakot",
      "Dhading",
      "Kathmandu",
      "Bhaktapur",
      "Lalitpur",
      "Makwanpur",
      "Chitwan",
    ],
  ],
  [
    "Gandaki",
    [
      "Gorkha",
      "Manang",
      "Mustang",
      "Myagdi",
      "Kaski",
      "Lamjung",
      "Tanahun",
      "Syangja",
      "Parbat",
      "Baglung",
      "Nawalpur",
    ],
  ],
  [
    "Lumbini",
    [
      "Rupandehi",
      "Kapilvastu",
      "Palpa",
      "Arghakhanchi",
      "Gulmi",
      "Dang",
      "Pyuthan",
      "Rolpa",
      "Rukum East",
      "Banke",
      "Bardiya",
      "Nawalparasi West",
    ],
  ],
  [
    "Karnali",
    [
      "Dolpa",
      "Humla",
      "Jumla",
      "Kalikot",
      "Mugu",
      "Surkhet",
      "Dailekh",
      "Jajarkot",
      "Salyan",
      "Rukum West",
    ],
  ],
  [
    "Sudurpashchim",
    [
      "Bajura",
      "Bajhang",
      "Doti",
      "Achham",
      "Kailali",
      "Kanchanpur",
      "Dadeldhura",
      "Baitadi",
      "Darchula",
    ],
  ],
];

/** Districts the territorial model treats as remote (a harder place to develop football). */
const REMOTE_DISTRICTS = ["Manang", "Mustang", "Dolpa", "Humla", "Mugu", "Jumla", "Kalikot", "Bajura", "Bajhang", "Darchula", "Solukhumbu"];

export const NEPAL_GEOGRAPHY: PackGeography = {
  idNamespace: "nepal",
  codePrefix: "NP",
  areas: PROVINCE_DISTRICTS.map(([province, districts]) => ({
    name: province,
    kind: "province",
    children: districts.map((district) => ({ name: district, kind: "district", remote: REMOTE_DISTRICTS.includes(district) })),
  })),
  clubLocalityHubs: ["Kathmandu", "Lalitpur", "Bhaktapur", "Kaski", "Morang"],
};

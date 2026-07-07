// Generated static list of ITU E.164 country dial codes for the subscribe panel's phone
// channel — all countries and dialing territories, alphabetical by display name. Presentation
// data only: the page does light sanity checks and the backend validates numbers for real when
// the subscribe endpoint lands. `region` is the ISO 3166-1 alpha-2 code, used by the
// enhancement script to preselect from the browser locale.
export interface CountryDialCode {
  name: string;
  dial: string;
  region: string;
}

// Typical national digit groupings for format-as-you-type, keyed by region — presentational
// convenience only (the familiar way locals write the number); the backend owns real validation
// when the subscribe endpoint lands, and full libphonenumber-class metadata is deliberately not
// shipped on this standalone page. Countries with genuinely irregular numbering plans are
// omitted on purpose: they get digit-limiting without grouping, never a wrong-looking forced
// pattern. Every +1 country shares the NANP 3-3-4 shape.
export interface NationalNumberShape {
  groups?: readonly number[];
  maxDigits: number;
}

export const DEFAULT_MAX_NATIONAL_DIGITS = 12;

const NANP_SHAPE: NationalNumberShape = { groups: [3, 3, 4], maxDigits: 10 };

export const NATIONAL_NUMBER_SHAPES: Readonly<Record<string, NationalNumberShape>> = {
  AE: { groups: [2, 3, 4], maxDigits: 9 },
  AR: { maxDigits: 11 },
  AT: { maxDigits: 12 },
  AU: { groups: [3, 3, 3], maxDigits: 9 },
  BD: { maxDigits: 10 },
  BE: { maxDigits: 9 },
  BR: { groups: [2, 5, 4], maxDigits: 11 },
  CH: { groups: [2, 3, 2, 2], maxDigits: 9 },
  CL: { groups: [1, 4, 4], maxDigits: 9 },
  CN: { groups: [3, 4, 4], maxDigits: 11 },
  CO: { groups: [3, 3, 4], maxDigits: 10 },
  CZ: { groups: [3, 3, 3], maxDigits: 9 },
  DE: { maxDigits: 11 },
  DK: { groups: [2, 2, 2, 2], maxDigits: 8 },
  EG: { maxDigits: 10 },
  ES: { groups: [3, 3, 3], maxDigits: 9 },
  FI: { maxDigits: 10 },
  FR: { groups: [2, 2, 2, 2, 2], maxDigits: 10 },
  GB: { maxDigits: 10 },
  GH: { maxDigits: 9 },
  GR: { groups: [3, 3, 4], maxDigits: 10 },
  HK: { groups: [4, 4], maxDigits: 8 },
  HU: { maxDigits: 9 },
  ID: { maxDigits: 12 },
  IE: { groups: [2, 3, 4], maxDigits: 9 },
  IL: { groups: [2, 3, 4], maxDigits: 9 },
  IN: { groups: [5, 5], maxDigits: 10 },
  IT: { maxDigits: 11 },
  JP: { groups: [3, 4, 4], maxDigits: 11 },
  KE: { groups: [3, 3, 3], maxDigits: 9 },
  KR: { groups: [3, 4, 4], maxDigits: 11 },
  MX: { groups: [2, 4, 4], maxDigits: 10 },
  MY: { maxDigits: 10 },
  NG: { groups: [3, 3, 4], maxDigits: 10 },
  NL: { maxDigits: 10 },
  NO: { groups: [3, 2, 3], maxDigits: 8 },
  NZ: { maxDigits: 10 },
  PE: { maxDigits: 9 },
  PH: { groups: [3, 3, 4], maxDigits: 10 },
  PK: { groups: [3, 7], maxDigits: 10 },
  PL: { groups: [3, 3, 3], maxDigits: 9 },
  PT: { groups: [3, 3, 3], maxDigits: 9 },
  RO: { groups: [3, 3, 3], maxDigits: 9 },
  RU: { groups: [3, 3, 2, 2], maxDigits: 10 },
  SA: { groups: [2, 3, 4], maxDigits: 9 },
  SE: { maxDigits: 10 },
  SG: { groups: [4, 4], maxDigits: 8 },
  TH: { maxDigits: 9 },
  TR: { groups: [3, 3, 2, 2], maxDigits: 10 },
  TW: { maxDigits: 9 },
  UA: { groups: [2, 3, 2, 2], maxDigits: 9 },
  VE: { groups: [3, 3, 4], maxDigits: 10 },
  VN: { maxDigits: 10 },
  ZA: { groups: [2, 3, 4], maxDigits: 9 },
};

export function nationalNumberShapeFor(country: CountryDialCode): NationalNumberShape {
  if (country.dial === "+1") return NANP_SHAPE;
  return NATIONAL_NUMBER_SHAPES[country.region] ?? { maxDigits: DEFAULT_MAX_NATIONAL_DIGITS };
}

export const COUNTRY_DIAL_CODES: readonly CountryDialCode[] = [
  { name: "Afghanistan", dial: "+93", region: "AF" },
  { name: "Albania", dial: "+355", region: "AL" },
  { name: "Algeria", dial: "+213", region: "DZ" },
  { name: "American Samoa", dial: "+1", region: "AS" },
  { name: "Andorra", dial: "+376", region: "AD" },
  { name: "Angola", dial: "+244", region: "AO" },
  { name: "Anguilla", dial: "+1", region: "AI" },
  { name: "Antigua and Barbuda", dial: "+1", region: "AG" },
  { name: "Argentina", dial: "+54", region: "AR" },
  { name: "Armenia", dial: "+374", region: "AM" },
  { name: "Aruba", dial: "+297", region: "AW" },
  { name: "Australia", dial: "+61", region: "AU" },
  { name: "Austria", dial: "+43", region: "AT" },
  { name: "Azerbaijan", dial: "+994", region: "AZ" },
  { name: "Bahamas", dial: "+1", region: "BS" },
  { name: "Bahrain", dial: "+973", region: "BH" },
  { name: "Bangladesh", dial: "+880", region: "BD" },
  { name: "Barbados", dial: "+1", region: "BB" },
  { name: "Belarus", dial: "+375", region: "BY" },
  { name: "Belgium", dial: "+32", region: "BE" },
  { name: "Belize", dial: "+501", region: "BZ" },
  { name: "Benin", dial: "+229", region: "BJ" },
  { name: "Bermuda", dial: "+1", region: "BM" },
  { name: "Bhutan", dial: "+975", region: "BT" },
  { name: "Bolivia", dial: "+591", region: "BO" },
  { name: "Bosnia and Herzegovina", dial: "+387", region: "BA" },
  { name: "Botswana", dial: "+267", region: "BW" },
  { name: "Brazil", dial: "+55", region: "BR" },
  { name: "British Virgin Islands", dial: "+1", region: "VG" },
  { name: "Brunei", dial: "+673", region: "BN" },
  { name: "Bulgaria", dial: "+359", region: "BG" },
  { name: "Burkina Faso", dial: "+226", region: "BF" },
  { name: "Burundi", dial: "+257", region: "BI" },
  { name: "Cambodia", dial: "+855", region: "KH" },
  { name: "Cameroon", dial: "+237", region: "CM" },
  { name: "Canada", dial: "+1", region: "CA" },
  { name: "Cape Verde", dial: "+238", region: "CV" },
  { name: "Cayman Islands", dial: "+1", region: "KY" },
  { name: "Central African Republic", dial: "+236", region: "CF" },
  { name: "Chad", dial: "+235", region: "TD" },
  { name: "Chile", dial: "+56", region: "CL" },
  { name: "China", dial: "+86", region: "CN" },
  { name: "Colombia", dial: "+57", region: "CO" },
  { name: "Comoros", dial: "+269", region: "KM" },
  { name: "Congo (Democratic Republic)", dial: "+243", region: "CD" },
  { name: "Congo (Republic)", dial: "+242", region: "CG" },
  { name: "Cook Islands", dial: "+682", region: "CK" },
  { name: "Costa Rica", dial: "+506", region: "CR" },
  { name: "Croatia", dial: "+385", region: "HR" },
  { name: "Cuba", dial: "+53", region: "CU" },
  { name: "Curacao", dial: "+599", region: "CW" },
  { name: "Cyprus", dial: "+357", region: "CY" },
  { name: "Czechia", dial: "+420", region: "CZ" },
  { name: "Denmark", dial: "+45", region: "DK" },
  { name: "Djibouti", dial: "+253", region: "DJ" },
  { name: "Dominica", dial: "+1", region: "DM" },
  { name: "Dominican Republic", dial: "+1", region: "DO" },
  { name: "Ecuador", dial: "+593", region: "EC" },
  { name: "Egypt", dial: "+20", region: "EG" },
  { name: "El Salvador", dial: "+503", region: "SV" },
  { name: "Equatorial Guinea", dial: "+240", region: "GQ" },
  { name: "Eritrea", dial: "+291", region: "ER" },
  { name: "Estonia", dial: "+372", region: "EE" },
  { name: "Eswatini", dial: "+268", region: "SZ" },
  { name: "Ethiopia", dial: "+251", region: "ET" },
  { name: "Falkland Islands", dial: "+500", region: "FK" },
  { name: "Faroe Islands", dial: "+298", region: "FO" },
  { name: "Fiji", dial: "+679", region: "FJ" },
  { name: "Finland", dial: "+358", region: "FI" },
  { name: "France", dial: "+33", region: "FR" },
  { name: "French Guiana", dial: "+594", region: "GF" },
  { name: "French Polynesia", dial: "+689", region: "PF" },
  { name: "Gabon", dial: "+241", region: "GA" },
  { name: "Gambia", dial: "+220", region: "GM" },
  { name: "Georgia", dial: "+995", region: "GE" },
  { name: "Germany", dial: "+49", region: "DE" },
  { name: "Ghana", dial: "+233", region: "GH" },
  { name: "Gibraltar", dial: "+350", region: "GI" },
  { name: "Greece", dial: "+30", region: "GR" },
  { name: "Greenland", dial: "+299", region: "GL" },
  { name: "Grenada", dial: "+1", region: "GD" },
  { name: "Guadeloupe", dial: "+590", region: "GP" },
  { name: "Guam", dial: "+1", region: "GU" },
  { name: "Guatemala", dial: "+502", region: "GT" },
  { name: "Guernsey", dial: "+44", region: "GG" },
  { name: "Guinea", dial: "+224", region: "GN" },
  { name: "Guinea-Bissau", dial: "+245", region: "GW" },
  { name: "Guyana", dial: "+592", region: "GY" },
  { name: "Haiti", dial: "+509", region: "HT" },
  { name: "Honduras", dial: "+504", region: "HN" },
  { name: "Hong Kong", dial: "+852", region: "HK" },
  { name: "Hungary", dial: "+36", region: "HU" },
  { name: "Iceland", dial: "+354", region: "IS" },
  { name: "India", dial: "+91", region: "IN" },
  { name: "Indonesia", dial: "+62", region: "ID" },
  { name: "Iran", dial: "+98", region: "IR" },
  { name: "Iraq", dial: "+964", region: "IQ" },
  { name: "Ireland", dial: "+353", region: "IE" },
  { name: "Isle of Man", dial: "+44", region: "IM" },
  { name: "Israel", dial: "+972", region: "IL" },
  { name: "Italy", dial: "+39", region: "IT" },
  { name: "Ivory Coast", dial: "+225", region: "CI" },
  { name: "Jamaica", dial: "+1", region: "JM" },
  { name: "Japan", dial: "+81", region: "JP" },
  { name: "Jersey", dial: "+44", region: "JE" },
  { name: "Jordan", dial: "+962", region: "JO" },
  { name: "Kazakhstan", dial: "+7", region: "KZ" },
  { name: "Kenya", dial: "+254", region: "KE" },
  { name: "Kiribati", dial: "+686", region: "KI" },
  { name: "Kosovo", dial: "+383", region: "XK" },
  { name: "Kuwait", dial: "+965", region: "KW" },
  { name: "Kyrgyzstan", dial: "+996", region: "KG" },
  { name: "Laos", dial: "+856", region: "LA" },
  { name: "Latvia", dial: "+371", region: "LV" },
  { name: "Lebanon", dial: "+961", region: "LB" },
  { name: "Lesotho", dial: "+266", region: "LS" },
  { name: "Liberia", dial: "+231", region: "LR" },
  { name: "Libya", dial: "+218", region: "LY" },
  { name: "Liechtenstein", dial: "+423", region: "LI" },
  { name: "Lithuania", dial: "+370", region: "LT" },
  { name: "Luxembourg", dial: "+352", region: "LU" },
  { name: "Macau", dial: "+853", region: "MO" },
  { name: "Madagascar", dial: "+261", region: "MG" },
  { name: "Malawi", dial: "+265", region: "MW" },
  { name: "Malaysia", dial: "+60", region: "MY" },
  { name: "Maldives", dial: "+960", region: "MV" },
  { name: "Mali", dial: "+223", region: "ML" },
  { name: "Malta", dial: "+356", region: "MT" },
  { name: "Marshall Islands", dial: "+692", region: "MH" },
  { name: "Martinique", dial: "+596", region: "MQ" },
  { name: "Mauritania", dial: "+222", region: "MR" },
  { name: "Mauritius", dial: "+230", region: "MU" },
  { name: "Mayotte", dial: "+262", region: "YT" },
  { name: "Mexico", dial: "+52", region: "MX" },
  { name: "Micronesia", dial: "+691", region: "FM" },
  { name: "Moldova", dial: "+373", region: "MD" },
  { name: "Monaco", dial: "+377", region: "MC" },
  { name: "Mongolia", dial: "+976", region: "MN" },
  { name: "Montenegro", dial: "+382", region: "ME" },
  { name: "Montserrat", dial: "+1", region: "MS" },
  { name: "Morocco", dial: "+212", region: "MA" },
  { name: "Mozambique", dial: "+258", region: "MZ" },
  { name: "Myanmar", dial: "+95", region: "MM" },
  { name: "Namibia", dial: "+264", region: "NA" },
  { name: "Nauru", dial: "+674", region: "NR" },
  { name: "Nepal", dial: "+977", region: "NP" },
  { name: "Netherlands", dial: "+31", region: "NL" },
  { name: "New Caledonia", dial: "+687", region: "NC" },
  { name: "New Zealand", dial: "+64", region: "NZ" },
  { name: "Nicaragua", dial: "+505", region: "NI" },
  { name: "Niger", dial: "+227", region: "NE" },
  { name: "Nigeria", dial: "+234", region: "NG" },
  { name: "Niue", dial: "+683", region: "NU" },
  { name: "North Korea", dial: "+850", region: "KP" },
  { name: "North Macedonia", dial: "+389", region: "MK" },
  { name: "Northern Mariana Islands", dial: "+1", region: "MP" },
  { name: "Norway", dial: "+47", region: "NO" },
  { name: "Oman", dial: "+968", region: "OM" },
  { name: "Pakistan", dial: "+92", region: "PK" },
  { name: "Palau", dial: "+680", region: "PW" },
  { name: "Palestine", dial: "+970", region: "PS" },
  { name: "Panama", dial: "+507", region: "PA" },
  { name: "Papua New Guinea", dial: "+675", region: "PG" },
  { name: "Paraguay", dial: "+595", region: "PY" },
  { name: "Peru", dial: "+51", region: "PE" },
  { name: "Philippines", dial: "+63", region: "PH" },
  { name: "Poland", dial: "+48", region: "PL" },
  { name: "Portugal", dial: "+351", region: "PT" },
  { name: "Puerto Rico", dial: "+1", region: "PR" },
  { name: "Qatar", dial: "+974", region: "QA" },
  { name: "Reunion", dial: "+262", region: "RE" },
  { name: "Romania", dial: "+40", region: "RO" },
  { name: "Russia", dial: "+7", region: "RU" },
  { name: "Rwanda", dial: "+250", region: "RW" },
  { name: "Saint Helena", dial: "+290", region: "SH" },
  { name: "Saint Kitts and Nevis", dial: "+1", region: "KN" },
  { name: "Saint Lucia", dial: "+1", region: "LC" },
  { name: "Saint Martin", dial: "+590", region: "MF" },
  { name: "Saint Pierre and Miquelon", dial: "+508", region: "PM" },
  { name: "Saint Vincent and the Grenadines", dial: "+1", region: "VC" },
  { name: "Samoa", dial: "+685", region: "WS" },
  { name: "San Marino", dial: "+378", region: "SM" },
  { name: "Sao Tome and Principe", dial: "+239", region: "ST" },
  { name: "Saudi Arabia", dial: "+966", region: "SA" },
  { name: "Senegal", dial: "+221", region: "SN" },
  { name: "Serbia", dial: "+381", region: "RS" },
  { name: "Seychelles", dial: "+248", region: "SC" },
  { name: "Sierra Leone", dial: "+232", region: "SL" },
  { name: "Singapore", dial: "+65", region: "SG" },
  { name: "Sint Maarten", dial: "+1", region: "SX" },
  { name: "Slovakia", dial: "+421", region: "SK" },
  { name: "Slovenia", dial: "+386", region: "SI" },
  { name: "Solomon Islands", dial: "+677", region: "SB" },
  { name: "Somalia", dial: "+252", region: "SO" },
  { name: "South Africa", dial: "+27", region: "ZA" },
  { name: "South Korea", dial: "+82", region: "KR" },
  { name: "South Sudan", dial: "+211", region: "SS" },
  { name: "Spain", dial: "+34", region: "ES" },
  { name: "Sri Lanka", dial: "+94", region: "LK" },
  { name: "Sudan", dial: "+249", region: "SD" },
  { name: "Suriname", dial: "+597", region: "SR" },
  { name: "Sweden", dial: "+46", region: "SE" },
  { name: "Switzerland", dial: "+41", region: "CH" },
  { name: "Syria", dial: "+963", region: "SY" },
  { name: "Taiwan", dial: "+886", region: "TW" },
  { name: "Tajikistan", dial: "+992", region: "TJ" },
  { name: "Tanzania", dial: "+255", region: "TZ" },
  { name: "Thailand", dial: "+66", region: "TH" },
  { name: "Timor-Leste", dial: "+670", region: "TL" },
  { name: "Togo", dial: "+228", region: "TG" },
  { name: "Tokelau", dial: "+690", region: "TK" },
  { name: "Tonga", dial: "+676", region: "TO" },
  { name: "Trinidad and Tobago", dial: "+1", region: "TT" },
  { name: "Tunisia", dial: "+216", region: "TN" },
  { name: "Turkey", dial: "+90", region: "TR" },
  { name: "Turkmenistan", dial: "+993", region: "TM" },
  { name: "Turks and Caicos Islands", dial: "+1", region: "TC" },
  { name: "Tuvalu", dial: "+688", region: "TV" },
  { name: "Uganda", dial: "+256", region: "UG" },
  { name: "Ukraine", dial: "+380", region: "UA" },
  { name: "United Arab Emirates", dial: "+971", region: "AE" },
  { name: "United Kingdom", dial: "+44", region: "GB" },
  { name: "United States", dial: "+1", region: "US" },
  { name: "Uruguay", dial: "+598", region: "UY" },
  { name: "US Virgin Islands", dial: "+1", region: "VI" },
  { name: "Uzbekistan", dial: "+998", region: "UZ" },
  { name: "Vanuatu", dial: "+678", region: "VU" },
  { name: "Vatican City", dial: "+39", region: "VA" },
  { name: "Venezuela", dial: "+58", region: "VE" },
  { name: "Vietnam", dial: "+84", region: "VN" },
  { name: "Wallis and Futuna", dial: "+681", region: "WF" },
  { name: "Western Sahara", dial: "+212", region: "EH" },
  { name: "Yemen", dial: "+967", region: "YE" },
  { name: "Zambia", dial: "+260", region: "ZM" },
  { name: "Zimbabwe", dial: "+263", region: "ZW" },
];

// ---------------------------------------------------------------------------
// national-number formatting (pure; shared verbatim with the browser)

// EVERY country formats: the table's national grouping where known, otherwise a generic
// readability fallback — chunks of three with a two-to-four digit final group — so no country
// ever types an unbroken digit wall. The fallback is a readability device, not a national
// claim; the backend owns real validation when the subscribe endpoint lands.
//
// This function is injected into the page script via Function.prototype.toString, so the exact
// code under unit test is the code that runs in the browser. Keep it fully self-contained (no
// imports, no closures, no template literals) and plain enough to survive transpilation intact.
export function formatNationalDigits(digits: string, groupsAttribute: string | null): string {
  const cleaned = digits.replace(/\D/g, "");
  if (cleaned === "") return "";
  let groups: number[];
  if (groupsAttribute) {
    groups = groupsAttribute.split("-").map(function (part) {
      return parseInt(part, 10);
    });
  } else {
    groups = [];
    let remaining = cleaned.length;
    while (remaining > 4) {
      groups.push(3);
      remaining -= 3;
    }
    groups.push(remaining);
  }
  const parts: string[] = [];
  let position = 0;
  for (let index = 0; index < groups.length && position < cleaned.length; index += 1) {
    const groupSize = groups[index] as number;
    parts.push(cleaned.slice(position, position + groupSize));
    position += groupSize;
  }
  // Digits beyond the declared groups stay visible rather than silently vanishing.
  if (position < cleaned.length) parts.push(cleaned.slice(position));
  return parts.join(" ");
}

// Test- and server-facing entry: resolve a region's shape, cap to its digit limit, format.
export function formatNationalNumber(region: string, digits: string): string {
  const country = COUNTRY_DIAL_CODES.find((entry) => entry.region === region);
  const shape =
    country === undefined
      ? { maxDigits: DEFAULT_MAX_NATIONAL_DIGITS }
      : nationalNumberShapeFor(country);
  const capped = digits.replace(/\D/g, "").slice(0, shape.maxDigits);
  return formatNationalDigits(capped, shape.groups === undefined ? null : shape.groups.join("-"));
}

// Representative example digits for a country's placeholder, derived from the shape itself so
// the example can never disagree with the typing behavior: the classic fictional 555 pattern
// for NANP, and a plain sequential run at the shape's length elsewhere (obviously an example,
// never a real-looking published number).
export function exampleNationalDigitsFor(country: CountryDialCode): string {
  if (country.dial === "+1") return "5550100123";
  const shape = nationalNumberShapeFor(country);
  const length =
    shape.groups === undefined
      ? shape.maxDigits
      : shape.groups.reduce((total, group) => total + group, 0);
  return "123456789012345".slice(0, length);
}

export function examplePlaceholderFor(country: CountryDialCode): string {
  return formatNationalNumber(country.region, exampleNationalDigitsFor(country));
}

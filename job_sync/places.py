"""Is this posting in the United States, read off a line of free text.

The trackers are US lists by construction — a volunteer curates them for a US
audience. The ATS boards are not: they are every job the company has open
anywhere, so Munich, Singapore, Auckland and Ho Chi Minh arrive alongside Austin.

Location on those boards is prose, not a field. "San Francisco", "New York, NY",
"Austin, Texas, United States; South San Francisco, California, U", "Colombia,
Remote" are all real values seen in one crawl. Nothing here can be exact.

So the reading is deliberately lopsided, because the two mistakes do not cost the
same. Dropping a real US internship is invisible — the row simply never appears,
and nobody can miss what they never saw. Keeping a posting in Berlin costs one
glance at one row. The rule therefore is **keep unless the text says otherwise**:

  1. A US state, a state code, or a US marker anywhere in the string wins outright.
     It is checked first so that "Vancouver, WA" and "Georgia, US" land correctly.
  2. Failing that, a country or city that is unambiguously not in the US drops it.
  3. Anything else is kept, and unrecognised is the normal case for a bare city.
"""

from __future__ import annotations

import re

# Split on | rather than on whitespace: "new hampshire" and "rhode island" have to
# survive as one phrase, or "new" alone would make Auckland, New Zealand a US state.
US_STATES = frozenset(
    name.strip()
    for name in """
    alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|
    georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|
    massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|
    new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|
    oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|
    texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|
    district of columbia|puerto rico
    """.replace("\n", "").split("|")
    if name.strip()
)

# Matched against the original string, never the lowercased one. Half of these are
# ordinary English words in lowercase — IN, OR, ME, OK, HI, DE, LA, PA — and folding
# case would turn "Remote in Europe" into Indiana.
STATE_CODES = re.compile(
    r"\b(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|"
    r"N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b"
)

US_MARKERS = (
    "united states",
    "u.s.a",
    "u.s.",
    "usa",
    " us)",
    "(us",
    "us-",
    "us remote",
    "remote us",
    "america",
)

# Countries and the cities that stand in for them on a job board. Only entries that
# cannot also name somewhere in the US: no "Vancouver" (Washington has one), no
# "Birmingham" (Alabama), no "Ontario" (California). Georgia is left out entirely —
# it is a US state, and the state check runs first anyway.
NOT_US = frozenset(
    phrase.strip()
    for phrase in """
    afghanistan|albania|algeria|argentina|armenia|australia|austria|azerbaijan|
    bahrain|bangladesh|belarus|belgium|bolivia|bosnia|brazil|bulgaria|cambodia|
    cameroon|canada|chile|china|colombia|costa rica|croatia|cyprus|czechia|
    czech republic|denmark|ecuador|egypt|estonia|ethiopia|finland|france|
    germany|ghana|greece|guatemala|honduras|hungary|iceland|india|indonesia|iran|iraq|
    ireland|israel|italy|japan|jordan|kazakhstan|kenya|korea|kuwait|latvia|lebanon|
    lithuania|luxembourg|malaysia|malta|mexico|moldova|mongolia|morocco|netherlands|
    new zealand|nigeria|norway|pakistan|panama|paraguay|peru|philippines|poland|
    portugal|qatar|romania|russia|rwanda|saudi arabia|senegal|serbia|singapore|
    slovakia|slovenia|south africa|spain|sri lanka|sweden|switzerland|taiwan|
    tanzania|thailand|tunisia|turkey|uganda|ukraine|united arab emirates|
    united kingdom|uruguay|uzbekistan|venezuela|vietnam|zambia|zimbabwe|
    emea|apac|latam|benelux|nordics|europe|asia|africa|oceania|middle east|uk|
    amsterdam|auckland|bangalore|bengaluru|barcelona|beijing|belfast|berlin|bogota|
    brisbane|brussels|bucharest|budapest|buenos aires|cairo|canberra|cape town|
    chennai|copenhagen|dubai|dublin|dusseldorf|edinburgh|frankfurt|geneva|glasgow|
    gurgaon|gurugram|hamburg|hanoi|helsinki|ho chi minh|hong kong|hyderabad|
    islamabad|istanbul|jakarta|johannesburg|karachi|kuala lumpur|kyiv|lagos|lahore|
    lisbon|ljubljana|london|madrid|manchester|manila|melbourne|milan|montreal|moscow|
    mumbai|munich|nairobi|new delhi|noida|osaka|oslo|ottawa|paris|prague|pune|
    reykjavik|riga|rome|seoul|shanghai|shenzhen|sofia|stockholm|sydney|taipei|
    tallinn|tel aviv|tokyo|toronto|vienna|vilnius|warsaw|wellington|
    zagreb|zurich
    """.replace("\n", "").split("|")
    if phrase.strip()
)


def _contains(text: str, phrases: frozenset[str]) -> bool:
    """Whole-phrase containment. Bounded on both sides so that "indianapolis" is
    not Indiana and "chinatown" is not China."""
    return any(re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", text) for phrase in phrases)


def is_united_states(location: str) -> bool:
    """Keep unless the text says somewhere else.

    An empty location is kept. A board that does not say where the job is has not
    said the job is abroad, and a silent drop is the one failure nobody can see."""
    text = location.strip()
    if not text:
        return True
    lowered = text.casefold()
    if any(marker in lowered for marker in US_MARKERS):
        return True
    if _contains(lowered, US_STATES) or STATE_CODES.search(text):
        return True
    return not _contains(lowered, NOT_US)

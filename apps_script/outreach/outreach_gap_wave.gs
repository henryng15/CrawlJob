/**
 * outreach_gap_wave.gs — the 2026-09-24 cold-email gap wave.
 *
 * Owner request after the 10-day App audit (applications 2026-09-14 → 09-24): every employer
 * with a live application and no cold email yet gets recruiter mail. Rippling gets one message
 * to ctung@rippling.com (Backend role) on 09-25; employers already in the contacts database get
 * two recruiters (Waymo, Wells Fargo and State Farm excluded by the owner); the rest get three
 * recruiters at the twenty largest employers and two elsewhere. Recruiters are ordered
 * campus/early-career first, then technology/software, then general talent acquisition.
 * Next week's messages go out Monday–Thursday between 09:00 and 13:00 ET.
 *
 * The researched contacts come from treg people search (quickenrich/leadsforge/Exa/Hunter),
 * with the address built from the domain's Hunter pattern (or an email finder) and accepted only
 * when BounceBan returned `deliverable` with a score of at least 80.
 */

// Recruiters researched for this wave, appended to Contacts (manual) by
// appendGapWaveContacts20260924.
var GAP_WAVE_CONTACTS_20260924_ = [
  {
    "company": "Amperesand",
    "name": "Priti Sahu",
    "email": "priti@amperesand.com",
    "title": "Global Talent Acquisition Lead",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/nandapriti"
  },
  {
    "company": "Amperesand",
    "name": "Melissa Stephens",
    "email": "melissa@amperesand.com",
    "title": "Head of People and Talent",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/melissa-s-stephens"
  },
  {
    "company": "Antares",
    "name": "Alex Varnam",
    "email": "alex@antaresindustries.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/alexvarnam"
  },
  {
    "company": "Antares",
    "name": "Reuven Fridmar",
    "email": "reuven@antaresindustries.com",
    "title": "Head of Talent",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/reuvenfridmar"
  },
  {
    "company": "AspenTech",
    "name": "Belinda Cagle",
    "email": "belinda.cagle@aspentech.com",
    "title": "Principal Talent Acquisition Consultant - Sales",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/belindacagle"
  },
  {
    "company": "AspenTech",
    "name": "Wendell Johnson",
    "email": "wendell.johnson@aspentech.com",
    "title": "Principal Talent Acquisition Consultant",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/wendelljohnson"
  },
  {
    "company": "AspenTech",
    "name": "Rachel Roy",
    "email": "rachel.roy@aspentech.com",
    "title": "Associate Talent Acquisition Consultant (HR)",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/rachel-roy-8a6b0a206"
  },
  {
    "company": "Astronautics Corporation of America",
    "name": "Jesse Kern",
    "email": "j.kern@astronautics.com",
    "title": "Head of Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/jessekern"
  },
  {
    "company": "Astronautics Corporation of America",
    "name": "Sherry Jones",
    "email": "s.jones@astronautics.com",
    "title": "Human Resources Director",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/sherry-jones-phr-69556512"
  },
  {
    "company": "Athene",
    "name": "Mindy Butler",
    "email": "mbutler@athene.com",
    "title": "Talent Acquisition Specialist",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/mindy-butler"
  },
  {
    "company": "Athene",
    "name": "Krystin Thein",
    "email": "kthein@athene.com",
    "title": "Sr. Talent Acquisition Partner",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/krystin-thein-911102a1"
  },
  {
    "company": "Baidu USA",
    "name": "Fei Song",
    "email": "songfei@baidu.com",
    "title": "HR Manager",
    "focus": "",
    "verify": "BounceBan deliverable 99 (finder) 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/fei-song-140766171"
  },
  {
    "company": "Base Power Company",
    "name": "Elizabeth Hughes",
    "email": "ehughes@basepowercompany.com",
    "title": "Talent",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/ehughes7"
  },
  {
    "company": "Base Power Company",
    "name": "Edsel Rivera",
    "email": "erivera@basepowercompany.com",
    "title": "Talent",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/edselrivera"
  },
  {
    "company": "Bedrock Robotics",
    "name": "Jason Greenhouse",
    "email": "jason.greenhouse@bedrockrobotics.com",
    "title": "Senior Recruiter, Engineering (Machine Learning, Robotics, Infrastructure)",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/jasongreenhouse"
  },
  {
    "company": "Bedrock Robotics",
    "name": "Colleen Kurtz",
    "email": "colleen.kurtz@bedrockrobotics.com",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/colleen-kurtz"
  },
  {
    "company": "CAI",
    "name": "Cara Bertucci",
    "email": "cara.bertucci@cai.io",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/cara-bertucci"
  },
  {
    "company": "CAI",
    "name": "Amy Ebersole",
    "email": "amy.ebersole@cai.io",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/amy-ebersole-b2b517b2"
  },
  {
    "company": "CAI",
    "name": "Jordan McIntyre",
    "email": "jordan.mcintyre@cai.io",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/jordandmcintyre"
  },
  {
    "company": "Clockwork Systems",
    "name": "Jagruti Shah",
    "email": "jagruti@clockwork.io",
    "title": "Talent Acquisition Specialist",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/jagrutishah"
  },
  {
    "company": "Clockwork Systems",
    "name": "Denise Murphy",
    "email": "denise@clockwork.io",
    "title": "Senior Human Resources Manager",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/denise-murphy-clockwork"
  },
  {
    "company": "Cowboy Space Corporation",
    "name": "Anthony Bell",
    "email": "anthony.bell@cowboyspace.com",
    "title": "Sr. Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/anthony-m-bell"
  },
  {
    "company": "Cowboy Space Corporation",
    "name": "Woody Garrett",
    "email": "woody@cowboyspace.com",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/woodygarrett"
  },
  {
    "company": "DecisionPoint",
    "name": "Franklin Ojie",
    "email": "fojie@decisionpointcorp.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/franklin-ojie-092647157"
  },
  {
    "company": "DecisionPoint",
    "name": "Asher Packnett",
    "email": "apacknett@decisionpointcorp.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/asher-alexander-packnett-5a492b177"
  },
  {
    "company": "Emergent",
    "name": "Shreya Shandilya",
    "email": "shreya@emergent.sh",
    "title": "Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/shreya-shandilya-60533998"
  },
  {
    "company": "Emergent",
    "name": "Aarti Jha",
    "email": "aarti@emergent.sh",
    "title": "Head of Human Resources",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/aarti-jha-b2947410"
  },
  {
    "company": "Expedition Technology",
    "name": "Kristy Daniels",
    "email": "kristy.daniels@exptechinc.com",
    "title": "Senior Member of the Talent Acquisition Team",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kristy-daniels"
  },
  {
    "company": "Fidelity National Information Services",
    "name": "Brian Perrigoue",
    "email": "brian.perrigoue@fisglobal.com",
    "title": "FIS University Program Recruiter",
    "focus": "university",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/brianperrigoue"
  },
  {
    "company": "Fidelity National Information Services",
    "name": "Julie Forse",
    "email": "julie.forse@fisglobal.com",
    "title": "Global FIS University Program Talent Acquisition Manager Senior",
    "focus": "university",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/julie-forse-mba"
  },
  {
    "company": "Fidelity National Information Services",
    "name": "Corey Graf",
    "email": "corey.graf@fisglobal.com",
    "title": "Talent Acquisition Specialist and Project Manager | Early Talent",
    "focus": "university",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/coreygraf"
  },
  {
    "company": "GM Financial",
    "name": "Kathryn Kolski",
    "email": "kathryn.kolski@gmfinancial.com",
    "title": "University Relations Talent Advisor II",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kathryn-kolski"
  },
  {
    "company": "GM Financial",
    "name": "Kathryn Kwiecien",
    "email": "kathryn.kwiecien@gmfinancial.com",
    "title": "Talent Acquisition Manager- University Relations",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kathryn-kwiecien"
  },
  {
    "company": "GM Financial",
    "name": "Devin Hauer",
    "email": "devin.hauer@gmfinancial.com",
    "title": "Technical Recruiter - Software Development Engineers",
    "focus": "technical",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/devinhauer"
  },
  {
    "company": "Gecko",
    "name": "Sarah Kahl",
    "email": "sarah.kahl@geckorobotics.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/sarahcanfieldkahl"
  },
  {
    "company": "Gecko",
    "name": "Yeonhee Stanley",
    "email": "yeonhee.stanley@geckorobotics.com",
    "title": "People Operations Specialist",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/yeonheestanley"
  },
  {
    "company": "Genworth Financial",
    "name": "Natalie Augustine",
    "email": "natalie.augustine@genworth.com",
    "title": "Senior Campus Recruiter",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/natalieannaugustine"
  },
  {
    "company": "Genworth Financial",
    "name": "Lauren Farrell",
    "email": "lauren.farrell@genworth.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/laurenmfarrell731"
  },
  {
    "company": "Genworth Financial",
    "name": "Candace Toone",
    "email": "candace.toone@genworth.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/candacetoone"
  },
  {
    "company": "Graco",
    "name": "Jordan Maetche",
    "email": "jordan_maetche@graco.com",
    "title": "Talent Acquisition Sourcer",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/jordan-maetche-415971159"
  },
  {
    "company": "Graco",
    "name": "Zaryab Robinson",
    "email": "zaryab_robinson@graco.com",
    "title": "Principal Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/zaryabrobinson"
  },
  {
    "company": "Graco",
    "name": "Kirsten Engen",
    "email": "kirsten_m_engen@graco.com",
    "title": "Corporate Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 99 (finder) 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kirsten-engen-2ba24474"
  },
  {
    "company": "Imagine",
    "name": "Claudia Chavez",
    "email": "cchavez@theimaginegroup.com",
    "title": "Human Resources Director - Talent",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/claudia-chavez-75686a101"
  },
  {
    "company": "Imagine",
    "name": "Abigail Rogers",
    "email": "arogers@theimaginegroup.com",
    "title": "Human Resources Generalist",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/abigail-rogers-846544156"
  },
  {
    "company": "InterSystems",
    "name": "Richard Hoffend",
    "email": "richard.hoffend@intersystems.com",
    "title": "Senior Campus Recruiter",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/richard-hoffend"
  },
  {
    "company": "InterSystems",
    "name": "Tim Mulvey",
    "email": "tim.mulvey@intersystems.com",
    "title": "Team Lead, Campus Recruitment at InterSystems",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/tim-mulvey-8b175922"
  },
  {
    "company": "InterSystems",
    "name": "Gregory Ford",
    "email": "gregory.ford@intersystems.com",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/gregory-ford-57b4bb128"
  },
  {
    "company": "LexisNexis",
    "name": "Brandon Lowe",
    "email": "brandon.lowe@lexisnexis.com",
    "title": "Sr. Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/brandon-lowe-b7776012"
  },
  {
    "company": "LexisNexis",
    "name": "Kim Nelsen",
    "email": "kim.nelsen@lexisnexis.com",
    "title": "Talent Acquisition Specialist",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kim-nelsen-4a726915"
  },
  {
    "company": "LexisNexis",
    "name": "Aseza Pupuma",
    "email": "aseza.pupuma@lexisnexis.com",
    "title": "Talent Acquisition Partner",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/aseza-pupuma"
  },
  {
    "company": "National Life Insurance Company",
    "name": "Jessica Castillo",
    "email": "jcastillo@nationallife.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/jessica-castillo-92a8a9289"
  },
  {
    "company": "National Life Insurance Company",
    "name": "Austin Gee",
    "email": "agee@nationallife.com",
    "title": "Senior Talent Partner",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/austingee"
  },
  {
    "company": "PING",
    "name": "Adrienne Balland",
    "email": "adrienneb@ping.com",
    "title": "Human Resources Manager",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/adrienne-balland-shrm-cp-26857a39"
  },
  {
    "company": "Perpay",
    "name": "Ainsley Klein",
    "email": "ainsley@perpay.com",
    "title": "Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/ainsley-klein-8997382a5"
  },
  {
    "company": "Perpay",
    "name": "Brooke Brault",
    "email": "brooke@perpay.com",
    "title": "Head of People Operations",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/brookedimarco"
  },
  {
    "company": "Pratt Miller",
    "name": "Courtney Johnson",
    "email": "cjohnson@prattmiller.com",
    "title": "Sr Director, Recruiting and University Relations",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/courtney-johnson-466b033"
  },
  {
    "company": "Pratt Miller",
    "name": "Steven Vandenabeele",
    "email": "svandenabeele@prattmiller.com",
    "title": "Senior Talent Acquisition Partner",
    "focus": "",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/stevevandenabeele"
  },
  {
    "company": "Principal Global Services",
    "name": "Erin Wells",
    "email": "wells.erin@principal.com",
    "title": "Senior Talent Consultant - IT Talent Acquisition",
    "focus": "technical",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/erin-wells-56aa434"
  },
  {
    "company": "Principal Global Services",
    "name": "Autumn Gibbs",
    "email": "gibbs.autumn@principal.com",
    "title": "Talent Acquisition Partner",
    "focus": "",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/autumn-gibbs-33a948208"
  },
  {
    "company": "Principal Global Services",
    "name": "Samantha Ho",
    "email": "ho.samantha@principal.com",
    "title": "Talent Acquisition Partner",
    "focus": "",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/samanthasnho"
  },
  {
    "company": "PrizePicks",
    "name": "Kyle Brock",
    "email": "kyle.brock@prizepicks.com",
    "title": "Talent Attraction Partner, Early Careers",
    "focus": "university",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kyle-brock-07560297"
  },
  {
    "company": "PrizePicks",
    "name": "Amanda Will",
    "email": "amanda.will@prizepicks.com",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/willmandy"
  },
  {
    "company": "Q2",
    "name": "Helen Burrows",
    "email": "helen.burrows@q2.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/helen-burrows-95a34020"
  },
  {
    "company": "Q2",
    "name": "Mary Dunn",
    "email": "mary.dunn@q2.com",
    "title": "Senior Talent Management Specialist",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/marycdunn"
  },
  {
    "company": "Q2",
    "name": "Ashley Riesenfeld",
    "email": "ashley.riesenfeld@q2.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/ashley-riesenfeld"
  },
  {
    "company": "Ragle",
    "name": "Matthew Hallman",
    "email": "mhallman@ragleinc.com",
    "title": "Business Development / Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/matthew-hallman-bba-m-a-wset-240069233"
  },
  {
    "company": "Ragle",
    "name": "Payton Harp",
    "email": "pharp@ragleinc.com",
    "title": "Corporate Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/payton-harp-3027a7171"
  },
  {
    "company": "Relay",
    "name": "Prarna Desai",
    "email": "pdesai@relaypro.com",
    "title": "Director of Recruiting",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/prarnadesai"
  },
  {
    "company": "Relay",
    "name": "Alexandra Graham",
    "email": "agraham@relaypro.com",
    "title": "Senior Director of Human Resources",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/alexandragraham2"
  },
  {
    "company": "Reply",
    "name": "Ewa Domjan",
    "email": "e.domjan@reply.com",
    "title": "IT Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/ewa-domjan-bb97ab87"
  },
  {
    "company": "Reply",
    "name": "Andrea Ferro",
    "email": "a.ferro@reply.com",
    "title": "Senior Talent Acquisition Specialist | Tech & Corporate Hiring",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/andrea-ferro-44a26416a"
  },
  {
    "company": "Reply",
    "name": "Elaine Lourenço",
    "email": "e.lourenco@reply.com",
    "title": "Tech Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/elainel3"
  },
  {
    "company": "Rilla",
    "name": "Bo Cautaerts",
    "email": "bo@rilla.com",
    "title": "Founding Sourcer",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/bo-cautaerts"
  },
  {
    "company": "Rilla",
    "name": "Kacy Hogarth",
    "email": "kacy@rilla.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/kacyhogarth2024"
  },
  {
    "company": "SeatGeek",
    "name": "Katie Cavote",
    "email": "kcavote@seatgeek.com",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/katie-cavote"
  },
  {
    "company": "SeatGeek",
    "name": "Grant Goldenberg",
    "email": "ggoldenberg@seatgeek.com",
    "title": "Technical Recruiter II",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/grant-goldenberg-007779157"
  },
  {
    "company": "Serval",
    "name": "Carlos Lezama",
    "email": "carlos@serval.com",
    "title": "Head of Talent",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/calezama"
  },
  {
    "company": "Serval",
    "name": "Hayley Swanson",
    "email": "hayley.swanson@serval.com",
    "title": "Talent",
    "focus": "",
    "verify": "BounceBan deliverable 97 (finder) 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/hayleyhuffstutter"
  },
  {
    "company": "SingleStore",
    "name": "Sukhpreet Kaur",
    "email": "skaur@singlestore.com",
    "title": "associate talent acquisition partner",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/sukhpreet-kaur-a98403249"
  },
  {
    "company": "SingleStore",
    "name": "Rhaysa Pereira",
    "email": "rpereira@singlestore.com",
    "title": "Associate Talent Acquisition Partner",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/rhaysa-yuki-pereira-5635b7179"
  },
  {
    "company": "Smarty",
    "name": "Susan Young",
    "email": "susan@smarty.com",
    "title": "Human Resources Manager",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/susan-young-shrm-cp-63a5484"
  },
  {
    "company": "TD Bank",
    "name": "Whitney Smith",
    "email": "whitney.smith@td.com",
    "title": "Senior Campus Recruiter",
    "focus": "university",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/whitney-smith-572a29bb"
  },
  {
    "company": "TD Bank",
    "name": "Howard Muti",
    "email": "howard.muti@td.com",
    "title": "Senior IT Talent Acquisition Partner VP",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/howardmuti"
  },
  {
    "company": "TD Bank",
    "name": "Susan Wilson",
    "email": "susan.wilson@td.com",
    "title": "Senior Talent Acquisition Partner",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/susanwilson1"
  },
  {
    "company": "Talos",
    "name": "Jenny Walls",
    "email": "jenny.walls@talos.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/jenny-walls-48a26b207"
  },
  {
    "company": "Talos",
    "name": "Kyle Wiltshire",
    "email": "kyle.wiltshire@talos.com",
    "title": "Director, Head of Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/moonrakers"
  },
  {
    "company": "Tive",
    "name": "Jordan Boss",
    "email": "jordan.boss@tive.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/jordanboss"
  },
  {
    "company": "Tive",
    "name": "Majlinda Veliu",
    "email": "majlinda.veliu@tive.com",
    "title": "Recruitment Specialist",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/majlinda-veliu-83b5b4214"
  },
  {
    "company": "Tokyo Electron",
    "name": "Olga Needham",
    "email": "olga.needham@tel.com",
    "title": "Senior Director of Human Resources",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "hunter",
    "linkedin": "https://www.linkedin.com/in/olga-needham-80057a19"
  },
  {
    "company": "Tokyo Electron",
    "name": "Ryo Amini",
    "email": "ryo.amini@tel.com",
    "title": "HR Business Partner",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/ryo-amini-90a58420b"
  },
  {
    "company": "Tokyo Electron",
    "name": "Tami Garcia",
    "email": "tami.garcia@tel.com",
    "title": "Vice President Human Resources",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/trgtx"
  },
  {
    "company": "Tower Research Capital",
    "name": "Zoë Harris-Hohne",
    "email": "zharrishohne@tower-research.com",
    "title": "Associate, Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/zoë-harris-hohne-88511912a"
  },
  {
    "company": "Tower Research Capital",
    "name": "Vaughan Syer",
    "email": "vsyer@tower-research.com",
    "title": "Associate, Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": ""
  },
  {
    "company": "Tyler Technologies",
    "name": "Thomas Austin",
    "email": "thomas.austin@tylertech.com",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/thomasaustin1"
  },
  {
    "company": "Tyler Technologies",
    "name": "Kristian Forkner",
    "email": "kristian.forkner@tylertech.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kristian-forkner-706525157"
  },
  {
    "company": "Tyler Technologies",
    "name": "Stacy Puckett",
    "email": "stacy.puckett@tylertech.com",
    "title": "Senior Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/stacypuckett"
  },
  {
    "company": "URBN",
    "name": "Jen Aberin",
    "email": "jaberin@urbn.com",
    "title": "Sr. Recruiter | Design Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/jen-aberin"
  },
  {
    "company": "URBN",
    "name": "Georgie Cook",
    "email": "gcook@urbn.com",
    "title": "Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/georgie-cook-654b09221"
  },
  {
    "company": "URBN",
    "name": "Dominique DeAngelo",
    "email": "ddeangelo@urbn.com",
    "title": "Talent Acquisition Recruiter | Creative",
    "focus": "",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/dominique-deangelo-88228364"
  },
  {
    "company": "Udig",
    "name": "John Sweeney",
    "email": "john.sweeney@udig.com",
    "title": "Director Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/johnsweeneyrva"
  },
  {
    "company": "Udig",
    "name": "Josh Brown",
    "email": "josh@udig.com",
    "title": "Talent Acquisition Manager",
    "focus": "",
    "verify": "BounceBan deliverable 99 (finder) 2026-09-24",
    "source": "people search",
    "linkedin": "N/A"
  },
  {
    "company": "United Wholesale Mortgage",
    "name": "Olivia Beesley",
    "email": "obeesley@uwm.com",
    "title": "University Recruiter",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/olivia-beesley-251479272"
  },
  {
    "company": "United Wholesale Mortgage",
    "name": "Marissa Bui",
    "email": "mbui@uwm.com",
    "title": "University Recruiter",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/marissa-bui-54a951275"
  },
  {
    "company": "United Wholesale Mortgage",
    "name": "Emily Noel",
    "email": "enoel@uwm.com",
    "title": "University Recruiter",
    "focus": "university",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/emily-noel-"
  },
  {
    "company": "Viavi Solutions",
    "name": "Vinuta Salimani",
    "email": "vinuta.salimani@viavisolutions.com",
    "title": "Senior Recruiter",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/vinuta-salimani-5aa293265"
  },
  {
    "company": "Viavi Solutions",
    "name": "Susan Royer",
    "email": "susan.royer@viavisolutions.com",
    "title": "Director Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/susan-royer-1a5b97"
  },
  {
    "company": "Viavi Solutions",
    "name": "Aparna Vedpathak",
    "email": "aparna.vedpathak@viavisolutions.com",
    "title": "Business Manager - Talent Acquisition",
    "focus": "",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/aparna-vedpathak-22330032"
  },
  {
    "company": "WebstaurantStore",
    "name": "Victoria Garcia",
    "email": "vgarcia@webstaurantstore.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/victoriaigarcia"
  },
  {
    "company": "WebstaurantStore",
    "name": "Taylor Nunemacher",
    "email": "tnunemacher@webstaurantstore.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/taylor-nunemacher"
  },
  {
    "company": "WebstaurantStore",
    "name": "Hevenile D. Robertson",
    "email": "hrobertson@webstaurantstore.com",
    "title": "Recruiter & Community Relations Coodinator",
    "focus": "",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "exa",
    "linkedin": "https://www.linkedin.com/in/heveniledrobertson"
  },
  {
    "company": "Wellmark",
    "name": "Cody McClelland",
    "email": "mcclellandc@wellmark.com",
    "title": "Senior Technology Talent Acquisition Consultant",
    "focus": "technical",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/cody-mcclelland-6a295b11"
  },
  {
    "company": "Wellmark",
    "name": "Kaleigh Avis",
    "email": "avisk@wellmark.com",
    "title": "Talent Acquisition Consultant",
    "focus": "",
    "verify": "BounceBan deliverable 98 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/kaleigh-avis-59347186"
  },
  {
    "company": "WEX",
    "name": "Beatriz Bitencourt",
    "email": "beatriz.bitencourt@wexinc.com",
    "title": "Global Tech Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/beatriz-bitencourt-29745b181"
  },
  {
    "company": "WEX",
    "name": "Carla Cambridge",
    "email": "carla.cambridge@wexinc.com",
    "title": "Sr. Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/carla-cambridge"
  },
  {
    "company": "WEX",
    "name": "Vanessa Cubillas",
    "email": "vanessa.cubillas@wexinc.com",
    "title": "Technical Talent Acquisition Specialist",
    "focus": "technical",
    "verify": "BounceBan deliverable 97 2026-09-24",
    "source": "people search",
    "linkedin": ""
  },
  {
    "company": "ZipRecruiter",
    "name": "Avery Sorenson",
    "email": "avery.sorenson@ziprecruiter.com",
    "title": "Talent Acquisition Partner, Technology",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/avery-sorenson"
  },
  {
    "company": "ZipRecruiter",
    "name": "Cole Williams",
    "email": "cole.williams@ziprecruiter.com",
    "title": "Technical Recruiter",
    "focus": "technical",
    "verify": "BounceBan deliverable 99 2026-09-24",
    "source": "people search",
    "linkedin": "https://www.linkedin.com/in/cole-williams-38215769"
  }
];

// One pinned live application per employer, keyed by the App tab's company name. `display` is
// the employer name the email uses; `contactCompany` is the contacts-tab spelling.
var GAP_WAVE_APPLICATIONS_20260924_ = {
  "Amperesand": {
    "display": "Amperesand",
    "contactCompany": "Amperesand",
    "emails": [
      "priti@amperesand.com",
      "melissa@amperesand.com"
    ],
    "role": "Software Engineering Intern",
    "jobLink": "https://job-boards.greenhouse.io/amperesand/jobs/4409254009"
  },
  "Antares": {
    "display": "Antares",
    "contactCompany": "Antares",
    "emails": [
      "alex@antaresindustries.com",
      "reuven@antaresindustries.com"
    ],
    "role": "Software Intern - Summer 2027",
    "jobLink": "https://jobs.ashbyhq.com/antares/922a527d-9826-446d-9aba-ffc611995830"
  },
  "AspenTech": {
    "display": "AspenTech",
    "contactCompany": "AspenTech",
    "emails": [
      "belinda.cagle@aspentech.com",
      "wendell.johnson@aspentech.com",
      "rachel.roy@aspentech.com"
    ],
    "role": "Software Development Intern - Digital Grid Management - Summer 2027",
    "jobLink": "https://aspentech.wd5.myworkdayjobs.com/aspentech/job/Medina-Minnesota/Software-Development-Intern---Digital-Grid-Management---Summer-2027_R9456"
  },
  "Astronautics Corporation of America": {
    "display": "Astronautics Corporation of America",
    "contactCompany": "Astronautics Corporation of America",
    "emails": [
      "j.kern@astronautics.com",
      "s.jones@astronautics.com"
    ],
    "role": "Software Engineering Intern",
    "jobLink": "https://jobright.ai/jobs/info/6aaaeed640807b73bd392db6?utm_campaign=1079&utm_source=git"
  },
  "Athene": {
    "display": "Athene",
    "contactCompany": "Athene",
    "emails": [
      "mbutler@athene.com",
      "kthein@athene.com"
    ],
    "role": "Software Developer Intern",
    "jobLink": "https://athene.wd5.myworkdayjobs.com/athene_careers/job/West-Des-Moines-Iowa/Software-Developer-Internship-_R255125?utm_source=Simplify&ref=Simplify"
  },
  "Baidu USA": {
    "display": "Baidu USA",
    "contactCompany": "Baidu USA",
    "emails": [
      "songfei@baidu.com"
    ],
    "role": "Forward Deployed Engineer Intern",
    "jobLink": "https://jobright.ai/jobs/info/6aa4a586422289703bd676b7?utm_campaign=1079&utm_source=git"
  },
  "Base Power Company": {
    "display": "Base Power Company",
    "contactCompany": "Base Power Company",
    "emails": [
      "ehughes@basepowercompany.com",
      "erivera@basepowercompany.com"
    ],
    "role": "Software Engineering Intern",
    "jobLink": "https://jobright.ai/jobs/info/6aa81e5c82e82a31997c3d6a?utm_campaign=1079&utm_source=git"
  },
  "Bedrock Robotics": {
    "display": "Bedrock Robotics",
    "contactCompany": "Bedrock Robotics",
    "emails": [
      "jason.greenhouse@bedrockrobotics.com",
      "colleen.kurtz@bedrockrobotics.com"
    ],
    "role": "Internship 2027 Software Engineer, Fleet Platform",
    "jobLink": "https://jobs.ashbyhq.com/bedrock-robotics/8927dd7e-a48d-49a2-92eb-09ec059432f4"
  },
  "CAI": {
    "display": "CAI",
    "contactCompany": "CAI",
    "emails": [
      "cara.bertucci@cai.io",
      "amy.ebersole@cai.io",
      "jordan.mcintyre@cai.io"
    ],
    "role": "Software Developer Intern",
    "jobLink": "https://cai.wd5.myworkdayjobs.com/computer_aid/job/PA-CLIENT-STATE/Software-Developer-Intern_R8451?utm_source=Simplify&ref=Simplify"
  },
  "Clockwork Systems": {
    "display": "Clockwork Systems",
    "contactCompany": "Clockwork Systems",
    "emails": [
      "jagruti@clockwork.io",
      "denise@clockwork.io"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://job-boards.greenhouse.io/embed/job_app?for=clockworksystems&token=6174230004&jr_id=6aaac5c6c85610f4a484185d"
  },
  "Cowboy Space Corporation": {
    "display": "Cowboy Space Corporation",
    "contactCompany": "Cowboy Space Corporation",
    "emails": [
      "anthony.bell@cowboyspace.com",
      "woody@cowboyspace.com"
    ],
    "role": "Intern, Software Engineering, 2027",
    "jobLink": "https://jobs.ashbyhq.com/cowboyspace/56d1d7e4-fa7e-4c25-aa8b-6828447fc64a?embed=true"
  },
  "DecisionPoint": {
    "display": "DecisionPoint",
    "contactCompany": "DecisionPoint",
    "emails": [
      "fojie@decisionpointcorp.com",
      "apacknett@decisionpointcorp.com"
    ],
    "role": "Software Engineering Intern",
    "jobLink": "https://careers-decisionpointcorp.icims.com/jobs/3771/software-engineering-intern/job?mode=submit_apply"
  },
  "Emergent": {
    "display": "Emergent",
    "contactCompany": "Emergent",
    "emails": [
      "shreya@emergent.sh",
      "aarti@emergent.sh"
    ],
    "role": "Software Engineering Intern",
    "jobLink": "https://job-boards.greenhouse.io/embed/job_app?for=emergentlabsinc&token=4323651009&jr_id=6aaaeb884be87a72913a229d&utm_source=Simplify&gh_src=Simplify"
  },
  "Expedition Technology": {
    "display": "Expedition Technology",
    "contactCompany": "Expedition Technology",
    "emails": [
      "holly.palmer@exptechinc.com",
      "kristy.daniels@exptechinc.com"
    ],
    "role": "Summer 2027 Internship in Software Engineering - R146",
    "jobLink": "https://jobright.ai/jobs/info/6aac2cf73d96632d741a9988?utm_campaign=1079&utm_source=git"
  },
  "Fidelity National Information Services": {
    "display": "Fidelity National Information Services",
    "contactCompany": "Fidelity National Information Services",
    "emails": [
      "brian.perrigoue@fisglobal.com",
      "julie.forse@fisglobal.com",
      "corey.graf@fisglobal.com"
    ],
    "role": "Software Engineer Intern - FIS University Program",
    "jobLink": "https://fis.wd5.myworkdayjobs.com/searchjobs/job/US-FL-JAX-347/Intern--Software-Engineer--FIS-University-Program_JR0309512?utm_source=Simplify&ref=Simplify"
  },
  "GM financial": {
    "display": "GM Financial",
    "contactCompany": "GM Financial",
    "emails": [
      "kathryn.kolski@gmfinancial.com",
      "kathryn.kwiecien@gmfinancial.com",
      "devin.hauer@gmfinancial.com"
    ],
    "role": "Software Development Engineer Intern",
    "jobLink": "https://fa-exvu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/260818?utm_source=Simplify&ref=Simplify"
  },
  "Gecko": {
    "display": "Gecko",
    "contactCompany": "Gecko",
    "emails": [
      "sarah.kahl@geckorobotics.com",
      "yeonhee.stanley@geckorobotics.com"
    ],
    "role": "Full Stack Software Engineering Intern",
    "jobLink": "https://jobs.ashbyhq.com/gecko-robotics/01138338-ff3c-4982-8ba3-5401386bf082/application?jr_id=6aaaa08276707040fb081329"
  },
  "Genworth Financial": {
    "display": "Genworth Financial",
    "contactCompany": "Genworth Financial",
    "emails": [
      "natalie.augustine@genworth.com",
      "lauren.farrell@genworth.com",
      "candace.toone@genworth.com"
    ],
    "role": "Software Engineering Intern",
    "jobLink": "https://gnw.wd1.myworkdayjobs.com/GNW/job/Raleigh-North-Carolina/Software-Engineering-Intern_REQ-260367-1"
  },
  "Graco": {
    "display": "Graco",
    "contactCompany": "Graco",
    "emails": [
      "jordan_maetche@graco.com",
      "zaryab_robinson@graco.com",
      "kirsten_m_engen@graco.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://graco.wd501.myworkdayjobs.com/Graco_Careers/job/Dayton-Minnesota-USA-French-Lake/Software-Engineer-Intern_R0023556"
  },
  "Imagine": {
    "display": "Imagine",
    "contactCompany": "Imagine",
    "emails": [
      "cchavez@theimaginegroup.com",
      "arogers@theimaginegroup.com"
    ],
    "role": "Summer 2027 Software Development Intern",
    "jobLink": "https://jobright.ai/jobs/info/6aabffbc3e3ce93970c7b137?utm_campaign=1079&utm_source=git"
  },
  "InterSystems": {
    "display": "InterSystems",
    "contactCompany": "InterSystems",
    "emails": [
      "richard.hoffend@intersystems.com",
      "tim.mulvey@intersystems.com",
      "gregory.ford@intersystems.com"
    ],
    "role": "Micro-Intern: Web Development (IAP)",
    "jobLink": "https://job-boards.greenhouse.io/intersystems/jobs/7992646003"
  },
  "LexisNexis": {
    "display": "LexisNexis",
    "contactCompany": "LexisNexis",
    "emails": [
      "brandon.lowe@lexisnexis.com",
      "kim.nelsen@lexisnexis.com",
      "aseza.pupuma@lexisnexis.com"
    ],
    "role": "Software Engineer Internship",
    "jobLink": "https://jobright.ai/jobs/info/6aa9cfe309ae03adcacdf740?utm_campaign=1079&utm_source=git"
  },
  "National Life Insurance Company": {
    "display": "National Life Insurance Company",
    "contactCompany": "National Life Insurance Company",
    "emails": [
      "jcastillo@nationallife.com",
      "agee@nationallife.com"
    ],
    "role": "IT Application Development Intern (Inforce) – Summer 2027",
    "jobLink": "https://job-boards.greenhouse.io/nationallifeinsurancecompany/jobs/4402184009"
  },
  "PING": {
    "display": "PING",
    "contactCompany": "PING",
    "emails": [
      "adrienneb@ping.com"
    ],
    "role": "Information Technology Internship",
    "jobLink": "https://jobright.ai/jobs/info/6aa80b3182e82a31997c3756?utm_campaign=1079&utm_source=git"
  },
  "Perpay": {
    "display": "Perpay",
    "contactCompany": "Perpay",
    "emails": [
      "ainsley@perpay.com",
      "brooke@perpay.com"
    ],
    "role": "Software Engineering Internship, Summer 2027",
    "jobLink": "https://job-boards.greenhouse.io/perpay/jobs/4076988007"
  },
  "Pratt Miller": {
    "display": "Pratt Miller",
    "contactCompany": "Pratt Miller",
    "emails": [
      "cjohnson@prattmiller.com",
      "svandenabeele@prattmiller.com"
    ],
    "role": "Software Engineer Intern - Summer 2027",
    "jobLink": "https://jobright.ai/jobs/info/6aa81f04654b2a9424cfabdb?utm_campaign=1079&utm_source=git"
  },
  "Principal Global Services": {
    "display": "Principal Global Services",
    "contactCompany": "Principal Global Services",
    "emails": [
      "wells.erin@principal.com",
      "gibbs.autumn@principal.com",
      "ho.samantha@principal.com"
    ],
    "role": "Software Engineer Internship - Des Moines, IA (Summer 2027)",
    "jobLink": "https://jobright.ai/jobs/info/6aa7fa61a77a53f5a1576972?utm_campaign=1079&utm_source=git"
  },
  "PrizePicks": {
    "display": "PrizePicks",
    "contactCompany": "PrizePicks",
    "emails": [
      "kyle.brock@prizepicks.com",
      "amanda.will@prizepicks.com"
    ],
    "role": "Software Engineering Internship - Summer 2027",
    "jobLink": "https://www.prizepicks.com/position?gh_jid=7999266003"
  },
  "Q2": {
    "display": "Q2",
    "contactCompany": "Q2",
    "emails": [
      "helen.burrows@q2.com",
      "mary.dunn@q2.com",
      "ashley.riesenfeld@q2.com"
    ],
    "role": "2027 Summer Internship - Software Engineer",
    "jobLink": "https://q2ebanking.wd5.myworkdayjobs.com/en-US/q2/job/XMLNAME-2027-Summer-Internship---Software-Engineer_REQ-12794"
  },
  "Ragle": {
    "display": "Ragle",
    "contactCompany": "Ragle",
    "emails": [
      "mhallman@ragleinc.com",
      "pharp@ragleinc.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://ragleinc.applytojob.com/apply/lonTfWhOqm/Software-Engineer-Intern?jr_id=6aaaf0ee40807b73bd392e7f"
  },
  "Relay": {
    "display": "Relay",
    "contactCompany": "Relay",
    "emails": [
      "pdesai@relaypro.com",
      "agraham@relaypro.com"
    ],
    "role": "Relay Launchpad Intern - Software Engineer (AI/ML)",
    "jobLink": "https://job-boards.greenhouse.io/relaypro/jobs/8176774"
  },
  "Reply": {
    "display": "Reply",
    "contactCompany": "Reply",
    "emails": [
      "e.domjan@reply.com",
      "a.ferro@reply.com",
      "e.lourenco@reply.com"
    ],
    "role": "AI/Machine Learning Intern",
    "jobLink": "https://jobs.lever.co/reply/74422215-dd06-404a-a35c-3c9bd80e1f0b"
  },
  "Rilla": {
    "display": "Rilla",
    "contactCompany": "Rilla",
    "emails": [
      "bo@rilla.com",
      "kacy@rilla.com"
    ],
    "role": "Software Engineering Intern, 2028 Grads",
    "jobLink": "https://jobs.ashbyhq.com/rilla/0e111ca4-3837-43d2-8507-6030a0dc32d9/application?jr_id=6aa9ba933387a3d9b67d666e&utm_source=Simplify"
  },
  "SeatGeek": {
    "display": "SeatGeek",
    "contactCompany": "SeatGeek",
    "emails": [
      "kcavote@seatgeek.com",
      "ggoldenberg@seatgeek.com"
    ],
    "role": "Software Engineer - Internship",
    "jobLink": "https://seatgeek.com/jobs/8227553?gh_jid=8227553&gh_src=Simplify"
  },
  "Serval": {
    "display": "Serval",
    "contactCompany": "Serval",
    "emails": [
      "carlos@serval.com",
      "hayley.swanson@serval.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://jobs.ashbyhq.com/serval/d7fb089c-db8a-4877-a5f3-73a09e67f54b/application?jr_id=6a5528b6377f983ce8a982e2"
  },
  "SingleStore": {
    "display": "SingleStore",
    "contactCompany": "SingleStore",
    "emails": [
      "skaur@singlestore.com",
      "rpereira@singlestore.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://job-boards.greenhouse.io/singlestore/jobs/8154399"
  },
  "Smarty": {
    "display": "Smarty",
    "contactCompany": "Smarty",
    "emails": [
      "susan@smarty.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://ats.rippling.com/smarty/jobs/76ceddee-de0a-4218-a9fb-976bd420558a?jr_id=6aa9ed5eeff87f571fc9c95d"
  },
  "TD Bank": {
    "display": "TD Bank",
    "contactCompany": "TD Bank",
    "emails": [
      "whitney.smith@td.com",
      "howard.muti@td.com",
      "susan.wilson@td.com"
    ],
    "role": "2027 Summer Internship Program - Global Technology & Solutions - Software Engineer (SWE)",
    "jobLink": "https://td.wd3.myworkdayjobs.com/TD_Bank_Careers/job/Mount-Laurel-New-Jersey/XMLNAME-2027-Summer-Internship-Program---Global-Technology---Solutions---Software-Engineer--SWE-_R_1510796-1"
  },
  "Talos": {
    "display": "Talos",
    "contactCompany": "Talos",
    "emails": [
      "jenny.walls@talos.com",
      "kyle.wiltshire@talos.com"
    ],
    "role": "Software Engineer Intern - Trading",
    "jobLink": "https://jobs.ashbyhq.com/Talos-Trading/42cad756-c312-4142-a9b7-18ed76f61c5d/application?embed=true&utm_source=Simplify&ref=Simplify"
  },
  "Tive": {
    "display": "Tive",
    "contactCompany": "Tive",
    "emails": [
      "jordan.boss@tive.com",
      "majlinda.veliu@tive.com"
    ],
    "role": "Software Engineer Co-op",
    "jobLink": "https://jobright.ai/jobs/info/6aa7e3be2ed333b4ea5cc415?utm_campaign=1079&utm_source=git"
  },
  "Tokyo Electron": {
    "display": "Tokyo Electron",
    "contactCompany": "Tokyo Electron",
    "emails": [
      "olga.needham@tel.com",
      "ryo.amini@tel.com",
      "tami.garcia@tel.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://tel.wd3.myworkdayjobs.com/tel-careers/job/Chaska/Software-Engineer-2027-Summer-Intern_R26-01573?utm_source=Simplify&ref=Simplify"
  },
  "Tower Research Capital": {
    "display": "Tower Research Capital",
    "contactCompany": "Tower Research Capital",
    "emails": [
      "zharrishohne@tower-research.com",
      "vsyer@tower-research.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://tower-research.com/open-positions/?gh_jid=8212158"
  },
  "Tyler Technologies": {
    "display": "Tyler Technologies",
    "contactCompany": "Tyler Technologies",
    "emails": [
      "thomas.austin@tylertech.com",
      "kristian.forkner@tylertech.com",
      "stacy.puckett@tylertech.com"
    ],
    "role": "Software Development Intern",
    "jobLink": "https://jobs.jobvite.com/tylertech/job/oAVOAfwD?nl=1&nl=1&fr=false&utm_source=Simplify&ref=Simplify"
  },
  "URBN": {
    "display": "URBN",
    "contactCompany": "URBN",
    "emails": [
      "jaberin@urbn.com",
      "gcook@urbn.com",
      "ddeangelo@urbn.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://homeoffice-na-urbn.icims.com/jobs/30602/job?mobile=true&needsRedirect=false&utm_source=Simplify&ref=Simplify"
  },
  "Udig": {
    "display": "Udig",
    "contactCompany": "Udig",
    "emails": [
      "john.sweeney@udig.com",
      "josh@udig.com"
    ],
    "role": "Software Engineer Intern",
    "jobLink": "https://udig.com/careers/job-listing/?gh_jid=7999436003&utm_source=Simplify&ref=Simplify"
  },
  "United Wholesale Mortgage": {
    "display": "United Wholesale Mortgage",
    "contactCompany": "United Wholesale Mortgage",
    "emails": [
      "obeesley@uwm.com",
      "mbui@uwm.com",
      "enoel@uwm.com"
    ],
    "role": "2027 Technology Summer Internship Program",
    "jobLink": "https://jobright.ai/jobs/info/6aa8078b2ed333b4ea5cccca?utm_campaign=1079&utm_source=git"
  },
  "Viavi Solutions": {
    "display": "Viavi Solutions",
    "contactCompany": "Viavi Solutions",
    "emails": [
      "vinuta.salimani@viavisolutions.com",
      "susan.royer@viavisolutions.com",
      "aparna.vedpathak@viavisolutions.com"
    ],
    "role": "Software Engineering Co-Op",
    "jobLink": "https://viavisolutions.wd1.myworkdayjobs.com/careers/job/Germantown-MD-USA/Software-Engineering-Co-Op_260005140-1"
  },
  "WebstaurantStore": {
    "display": "WebstaurantStore",
    "contactCompany": "WebstaurantStore",
    "emails": [
      "vgarcia@webstaurantstore.com",
      "tnunemacher@webstaurantstore.com",
      "hrobertson@webstaurantstore.com"
    ],
    "role": "2027 Full Stack Development Summer Internship",
    "jobLink": "https://jobright.ai/jobs/info/6ab14003d43eb922ca0bd9a6?utm_campaign=1079&utm_source=git"
  },
  "Wellmark": {
    "display": "Wellmark",
    "contactCompany": "Wellmark",
    "emails": [
      "mcclellandc@wellmark.com",
      "avisk@wellmark.com"
    ],
    "role": "Software Engineer Internship - Technology Healthcare Innovation",
    "jobLink": "https://jobs.smartrecruiters.com/WellmarkInc/744000150732768"
  },
  "Wex": {
    "display": "WEX",
    "contactCompany": "WEX",
    "emails": [
      "beatriz.bitencourt@wexinc.com",
      "carla.cambridge@wexinc.com",
      "vanessa.cubillas@wexinc.com"
    ],
    "role": "Fullstack Software Engineer Intern (Undergraduate)",
    "jobLink": "https://wexinc.wd5.myworkdayjobs.com/WEXInc/job/US---Remote/Backend-Software-Engineer-Intern--Undergraduate-_R22593"
  },
  "ZipRecruiter": {
    "display": "ZipRecruiter",
    "contactCompany": "ZipRecruiter",
    "emails": [
      "avery.sorenson@ziprecruiter.com",
      "cole.williams@ziprecruiter.com"
    ],
    "role": "Software Engineer - Intern",
    "jobLink": "https://job-boards.greenhouse.io/embed/job_app?for=ziprecruiter&token=8180455&jr_id=6ab426190e0ae54eeea46e6d"
  },
  "LabCorp": {
    "display": "LabCorp",
    "contactCompany": "LabCorp",
    "emails": [
      "sarah.odeh@labcorp.com",
      "emily.ashbrook@labcorp.com"
    ],
    "role": "Intern - Software Developer (also open for Winter 2027)",
    "jobLink": "https://labcorp.wd1.myworkdayjobs.com/external/job/Durham-NC/Intern---Software-Developer_2632330"
  },
  "Gordon Food Service": {
    "display": "Gordon Food Service",
    "contactCompany": "Gordon Food Service",
    "emails": [
      "ryan.moliassa@gfs.com",
      "gavin.tucker@gfs.com"
    ],
    "role": "Cloud DevOps Internship",
    "jobLink": "https://gfs.wd5.myworkdayjobs.com/usjobs-gen-gfs/job/Atlanta-Georgia/Cloud-DevOps-Internship_R-57259"
  },
  "Persona": {
    "display": "Persona",
    "contactCompany": "Persona",
    "emails": [
      "amanda@withpersona.com",
      "melanie@withpersona.com"
    ],
    "role": "Software Engineer, Intern (Summer 2027)",
    "jobLink": "https://jobs.ashbyhq.com/persona/eb77c97c-fa9d-4bf0-9566-e5ba4453b7d3?jr_id=6aaaf9f6f6bd9d2d17c1aaa7&utm_source=Simplify"
  },
  "Rippling": {
    "display": "Rippling",
    "contactCompany": "Rippling",
    "emails": [
      "ctung@rippling.com"
    ],
    "role": "Software Engineer Intern - Backend Focused - Summer 2027",
    "jobLink": "https://ats.rippling.com/rippling/jobs/a07e4e46-3721-4934-b57b-0d58412e22ba/apply?jobBoardSlug=rippling&jobId=a07e4e46-3721-4934-b57b-0d58412e22ba&step=confirmation"
  }
};

// Delivery days. Each is one direct recruiter campaign on the shared trigger; employers are
// dealt across the week by recipient count so each morning carries a similar load.
var GAP_WAVE_DAYS_20260924_ = [
  {
    "key": "TARGET_RECRUITER_CAMPAIGN_20260925_GAP_RIPPLING",
    "startIso": "2026-09-25T09:30:00-04:00",
    "spacingMinutes": 6,
    "companies": [
      "Rippling"
    ]
  },
  {
    "key": "TARGET_RECRUITER_CAMPAIGN_20260928_GAP",
    "startIso": "2026-09-28T09:00:00-04:00",
    "spacingMinutes": 7,
    "companies": [
      "AspenTech",
      "Genworth Financial",
      "Principal Global Services",
      "Tokyo Electron",
      "Viavi Solutions",
      "Antares",
      "Bedrock Robotics",
      "Emergent",
      "Imagine",
      "Persona",
      "Relay",
      "SingleStore",
      "Udig",
      "PING"
    ]
  },
  {
    "key": "TARGET_RECRUITER_CAMPAIGN_20260929_GAP",
    "startIso": "2026-09-29T09:00:00-04:00",
    "spacingMinutes": 8,
    "companies": [
      "GM financial",
      "LexisNexis",
      "TD Bank",
      "United Wholesale Mortgage",
      "Amperesand",
      "Base Power Company",
      "DecisionPoint",
      "Gordon Food Service",
      "Perpay",
      "Ragle",
      "Serval",
      "Tower Research Capital",
      "Baidu USA",
      "Smarty"
    ]
  },
  {
    "key": "TARGET_RECRUITER_CAMPAIGN_20260930_GAP",
    "startIso": "2026-09-30T09:00:00-04:00",
    "spacingMinutes": 7,
    "companies": [
      "CAI",
      "Graco",
      "Q2",
      "Tyler Technologies",
      "WebstaurantStore",
      "Astronautics Corporation of America",
      "Clockwork Systems",
      "Expedition Technology",
      "LabCorp",
      "Pratt Miller",
      "Rilla",
      "Talos",
      "Wellmark"
    ]
  },
  {
    "key": "TARGET_RECRUITER_CAMPAIGN_20261001_GAP",
    "startIso": "2026-10-01T09:00:00-04:00",
    "spacingMinutes": 7,
    "companies": [
      "Fidelity National Information Services",
      "InterSystems",
      "Reply",
      "URBN",
      "Wex",
      "Athene",
      "Cowboy Space Corporation",
      "Gecko",
      "National Life Insurance Company",
      "PrizePicks",
      "SeatGeek",
      "Tive",
      "ZipRecruiter"
    ]
  }
];

/**
 * Append this wave's researched recruiters to Contacts (manual). An address
 * already on either contacts tab is left where it is and reported; a company
 * that already has a spelling on file keeps that spelling, so the new row
 * groups with the employer it already has. `dryRun` writes nothing.
 */
function appendGapWaveContacts20260924(dryRun) {
  var book = SpreadsheetApp.openById(outreachProperty_(PROP_CONTACTS_ID, true));
  var manual = book.getSheetByName(TAB_CONTACTS_MANUAL);
  if (!manual) throw new Error('Contacts (manual) is missing.');

  var seenAt = {};
  [TAB_CONTACTS_SEED, TAB_CONTACTS_MANUAL].forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, C_WIDTH).getValues().forEach(function (row, i) {
      var email = outreachCell_(row, C_EMAIL).toLowerCase();
      if (email) seenAt[email] = name + ':' + (i + 2);
    });
  });

  var rows = [], added = [], existing = [];
  GAP_WAVE_CONTACTS_20260924_.forEach(function (person) {
    var email = person.email.toLowerCase();
    if (seenAt[email]) { existing.push(email + '\t' + seenAt[email]); return; }
    var row = new Array(C_WIDTH).fill('');
    row[C_COMPANY - 1] = person.company;
    row[C_NAME - 1] = person.name;
    row[C_EMAIL - 1] = email;
    row[C_ROLE - 1] = person.title;
    row[C_FOCUS - 1] = person.focus;
    row[C_VERIFY - 1] = person.verify;
    row[C_FROM - 1] = 'Cold-email gap wave 2026-09-24 — treg ' + person.source +
      (person.linkedin ? '; ' + person.linkedin : '');
    rows.push(row);
    added.push(person.company + '\t' + email + '\t' + person.name);
    seenAt[email] = 'this import';
  });

  if (!dryRun && rows.length) {
    manual.getRange(manual.getLastRow() + 1, 1, rows.length, C_WIDTH).setValues(rows);
  }
  return {dryRun: !!dryRun, total: GAP_WAVE_CONTACTS_20260924_.length,
          existing: existing, added: added};
}

/**
 * Schedule the wave's direct recruiter campaigns. Each day is an explicit
 * `TARGET_RECRUITER_CAMPAIGN_*` property on the shared recruiter trigger, with
 * `exactContacts` so a recipient spent between research and scheduling fails
 * the day instead of silently shrinking it. Before anything is written, every
 * pinned application must still be live at its exact link and clear of a
 * matching Gmail rejection. `dayKeys` limits the run to some days; empty
 * schedules every day.
 */
function scheduleGapWave20260924(dayKeys) {
  var only = {};
  (dayKeys || []).forEach(function (key) { only[key] = true; });
  var days = GAP_WAVE_DAYS_20260924_.filter(function (day) {
    return !Object.keys(only).length || only[day.key];
  });
  if (!days.length) throw new Error('No gap-wave day matches ' + JSON.stringify(dayKeys) + '.');

  var tracker = SpreadsheetApp.openById(outreachProperty_(PROP_TRACKER_ID, true));
  var apps = targetMirrorApplications_(tracker);
  var candidates = outreachGmailApiRejectionCandidates_();
  var blocked = [];
  days.forEach(function (day) {
    day.companies.forEach(function (company) {
      var spec = GAP_WAVE_APPLICATIONS_20260924_[company];
      if (!spec) throw new Error(company + ' has no pinned application.');
      var live = apps.filter(function (app) {
        return String(app.official || app.link || '') === spec.jobLink && outreachQualifies_(app.process);
      });
      // App can hold the same posting twice (two boards, one link); one live row is enough.
      if (!live.length) throw new Error(company + ': no active application at the pinned link.');
      var rejection = outreachGmailApiRejectedTarget_(
        {company: spec.display, role: spec.role, jobLink: spec.jobLink}, candidates);
      if (rejection.rejected) blocked.push(company + ' (' + rejection.why + ')');
    });
  });
  if (blocked.length) throw new Error('Gmail rejection preflight blocked: ' + blocked.join('; '));

  return days.map(function (day) {
    var emails = [];
    var companies = day.companies.map(function (company) {
      var spec = GAP_WAVE_APPLICATIONS_20260924_[company];
      emails = emails.concat(spec.emails);
      return {company: spec.display, contactCompanies: [spec.contactCompany],
              role: spec.role, jobLink: spec.jobLink, maxContacts: spec.emails.length};
    });
    return scheduleTargetRecruiterCampaign_({
      propertyKey: day.key, handler: 'runTargetRecruiterSharedTick_', reuseExistingTrigger: true,
      label: 'Cold-email gap wave', startIso: day.startIso,
      spacingMinutes: day.spacingMinutes, minGapMinutes: 5,
      exactContacts: emails.length, includeEmails: emails, companies: companies
    });
  });
}

/**
 * Owner call-off: cancel every still-pending entry for the named employers
 * (display names) across the wave's days. Sent entries are left as they are.
 */
function cancelGapWave20260924Companies(companies, reason) {
  var names = {};
  (companies || []).forEach(function (company) { names[company] = true; });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another outreach run holds the lock.');
  try {
    var props = PropertiesService.getScriptProperties();
    var result = GAP_WAVE_DAYS_20260924_.map(function (day) {
      var text = props.getProperty(day.key);
      if (!text) return {key: day.key, notScheduled: true};
      var state = JSON.parse(text);
      var cancelled = [], alreadyDone = [];
      state.entries.forEach(function (entry) {
        if (!names[entry.company]) return;
        if (entry.status !== 'pending') { alreadyDone.push(entry.company + ' ' + entry.status); return; }
        entry.status = 'cancelled';
        entry.completedAt = new Date().toISOString();
        entry.error = 'Cancelled by owner: ' + (reason || 'called off');
        cancelled.push(entry.company + ' ' + entry.email);
      });
      if (!state.entries.some(function (entry) { return entry.status === 'pending'; })) {
        state.status = 'complete';
        state.completedAt = new Date().toISOString();
      }
      props.setProperty(day.key, JSON.stringify(state));
      return {key: day.key, cancelled: cancelled, notPending: alreadyDone};
    });
    try { refreshTargetQueueTabs_(); }
    catch (mirrorError) { Logger.log('Target mirror refresh failed: ' + mirrorError); }
    return result;
  } finally {
    lock.releaseLock();
  }
}

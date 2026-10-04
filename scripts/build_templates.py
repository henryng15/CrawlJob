"""Generate apps_script/outreach/outreach_templates.gs from the two Markdown sources.

The wording lives in ColdEmail's `docs/henry_cold_email_templates_10.md` and
`docs/henry_referral.md`, which is where it is read and edited. Retyping it into
Apps Script would make the two drift the first time a sentence changed, and a
template that no longer matches the document it came from is the kind of error
nobody sees until it has been sent a hundred times.

So the .gs file is generated and never hand-edited. Change a sentence in the
Markdown and re-run this; the diff on the .gs shows exactly what moved.

Both files have the same shape, verified for all twenty templates:

    ## Template N
    **Subject:** ...
    Hi [Name],
    <one opening paragraph>
    **<heading>**
    > - four bullets
    **<heading>**
    > one paragraph
    **<heading>**
    > one paragraph
    <closing line>
    Best,
    <sign-off>

Placeholders are `[Name]`, `[Company]` and `[Role Name]`; nothing else varies.

    python scripts/build_templates.py [--check]
"""
import argparse
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
COLD_EMAIL = REPO.parent.parent / "ColdEmail"
OUT = REPO / "apps_script" / "outreach" / "outreach_templates.gs"

SOURCES = [
    ("COLD_TEMPLATES", COLD_EMAIL / "docs" / "henry_cold_email_templates_10.md",
     "the cold email to a recruiter"),
    ("REFERRAL_TEMPLATES", COLD_EMAIL / "docs" / "henry_referral.md",
     "the referral ask to an engineer"),
]

PLACEHOLDERS = {"[Name]", "[Company]", "[Role Name]"}


def parse(path):
    text = path.read_text(encoding="utf-8")
    chunks = re.split(r"^## Template \d+\s*$", text, flags=re.M)[1:]
    if len(chunks) != 10:
        sys.exit(f"{path.name}: expected 10 templates, found {len(chunks)}")

    out = []
    for n, chunk in enumerate(chunks, 1):
        body = chunk.split("\n---")[0]
        lines = [l.rstrip() for l in body.split("\n")]

        subject = None
        opening = None
        sections = []
        closing = []
        sign_off = None
        current = None
        seen_best = False

        for line in lines:
            s = line.strip()
            if not s:
                continue
            m = re.match(r"^\*\*Subject:\*\*\s*(.+)$", s)
            if m:
                subject = m.group(1).strip()
                continue
            if s.startswith("Hi [Name],"):
                continue
            if seen_best:
                sign_off = s
                seen_best = False
                continue
            if s in ("Best,", "Best,  "):
                seen_best = True
                continue
            m = re.match(r"^\*\*(.+?)\*\*$", s)
            if m:
                current = {"heading": m.group(1).strip(), "bullets": [], "body": ""}
                sections.append(current)
                continue
            if s.startswith("> - "):
                current["bullets"].append(s[4:].strip())
                continue
            if s.startswith("> "):
                current["body"] = s[2:].strip()
                continue
            if opening is None:
                opening = s
            else:
                # Every trailing paragraph, not just the last one. The referral
                # templates end with two -- "I've attached my resume for your
                # reference." and then the thank-you -- and keeping only the last
                # silently dropped the sentence that tells the reader there is an
                # attachment, on all ten of them.
                closing.append(s)

        problems = [name for name, v in
                    (("subject", subject), ("opening", opening),
                     ("closing", closing), ("sign-off", sign_off)) if not v]
        if problems or len(sections) != 3:
            sys.exit(f"{path.name} template {n}: missing {problems or ''} "
                     f"with {len(sections)} sections")
        for used in re.findall(r"\[[^\]]+\]", opening + subject
                               + " ".join(closing)
                               + "".join(s["heading"] + s["body"] + "".join(s["bullets"])
                                         for s in sections)):
            if used not in PLACEHOLDERS:
                sys.exit(f"{path.name} template {n}: unknown placeholder {used}")
        out.append({"subject": subject, "opening": opening, "sections": sections,
                    "closing": closing, "signOff": sign_off})
    return out


def js(value):
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def render(name, templates, description):
    lines = [f"var {name} = ["]
    for i, t in enumerate(templates, 1):
        lines.append(f"  {{   // {i}")
        lines.append(f"    subject: {js(t['subject'])},")
        lines.append(f"    opening: {js(t['opening'])},")
        lines.append("    sections: [")
        for s in t["sections"]:
            lines.append("      {")
            lines.append(f"        heading: {js(s['heading'])},")
            if s["bullets"]:
                lines.append("        bullets: [")
                for b in s["bullets"]:
                    lines.append(f"          {js(b)},")
                lines.append("        ],")
                lines.append("        body: ''")
            else:
                lines.append("        bullets: [],")
                lines.append(f"        body: {js(s['body'])}")
            lines.append("      },")
        lines.append("    ],")
        lines.append("    closing: [")
        for line in t["closing"]:
            lines.append(f"      {js(line)},")
        lines.append("    ],")
        lines.append(f"    signOff: {js(t['signOff'])}")
        lines.append("  },")
    lines.append("];")
    return "\n".join(lines)


HEADER = """/**
 * The email wording, generated -- do not edit this file by hand.
 *
 * Source: ColdEmail/docs/henry_cold_email_templates_10.md (cold) and
 * ColdEmail/docs/henry_referral.md (referral). Regenerate with
 * `python scripts/build_templates.py`, and `--check` fails if this file has
 * drifted from them.
 *
 * Ten templates each, one shape: a subject, one opening paragraph, three headed
 * sections (four bullets, then two short paragraphs), one or more closing
 * paragraphs and a sign-off. `**bold**` survives into both halves of the message through
 * outreachBoldHtml_ and outreachBoldPlain_.
 *
 * Only three placeholders exist -- [Name], [Company] and [Role Name] -- and the
 * generator refuses any other, because a placeholder nothing fills reaches a
 * recruiter as square brackets.
 */
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="fail if the generated file is out of date")
    args = ap.parse_args()

    parts = [HEADER]
    for name, path, description in SOURCES:
        if not path.exists():
            sys.exit(f"missing source: {path}")
        parts.append(f"\n// Ten variations of {description}.\n"
                     f"// From {path.name}.\n"
                     + render(name, parse(path), description) + "\n")
    text = "".join(parts)

    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            sys.exit(f"{OUT.name} is out of date; run python scripts/build_templates.py")
        print(f"{OUT.name} is up to date")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)} "
          f"({sum(len(parse(p)) for _, p, _ in SOURCES)} templates)")


if __name__ == "__main__":
    main()

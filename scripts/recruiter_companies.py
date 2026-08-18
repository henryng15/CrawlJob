"""Rebuild data/recruiter_companies.txt from the ColdEmail recruiter export.

Only the employer names cross over. The recruiter names, roles and addresses stay
where they were collected: this repo needs to know that a contact exists, never
who it is.

    python scripts/recruiter_companies.py ../ColdEmail/web/db/seed_recruiters.csv
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "job_sync" / "data" / "recruiter_companies.txt"
HEADER = """\
# Employers with at least one verified recruiter contact.
# Names only. The contacts themselves stay in the ColdEmail project; this
# file exists so the sync can mark an application without carrying anyone's
# name or address into this repo.
#
# Regenerate:
#   python scripts/recruiter_companies.py <path to seed_recruiters.csv>
"""


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as handle:
        names = {row["company_name"].strip() for row in csv.DictReader(handle)}
    names.discard("")
    TARGET.write_text(
        HEADER + "\n".join(sorted(names, key=str.casefold)) + "\n", encoding="utf-8"
    )
    print(f"{len(names)} companies -> {TARGET}")


if __name__ == "__main__":
    main()

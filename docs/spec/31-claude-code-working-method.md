# 31. Claude Code Working Method

Claude should use the following cycle for each milestone:

1. Restate milestone scope.
2. Inspect existing code.
3. Write or update an implementation plan.
4. Create tests first where practical.
5. Implement the smallest working slice.
6. Run:
   - formatter;
   - linter;
   - type checker;
   - unit tests;
   - integration tests.
7. Update:
   - `CLAUDE.md`;
   - `README.md`;
   - ADRs;
   - migration notes;
   - threat model when relevant.
8. Report:
   - files changed;
   - commands run;
   - test results;
   - security implications;
   - remaining limitations.
9. Do not proceed to the next milestone until acceptance criteria pass.

Suggested commands:

```bash
uv sync
uv run ruff format .
uv run ruff check .
uv run mypy app
uv run pytest -q
docker compose config
docker compose build
```

For infrastructure:

```bash
terraform fmt -check -recursive
terraform validate
tflint
checkov -d infra/terraform
```

---

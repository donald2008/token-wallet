---
name: Pull request
about: Submit changes to token-wallet
title: ""
labels: ""
assignees: ""
---

**What does this PR do?**
Brief description of the change and why.

**Type of change**
- [ ] Bug fix (non-breaking)
- [ ] New channel / feature
- [ ] Refactor / internal
- [ ] Docs / README

**If this adds or changes a channel**
- [ ] Verified against a **real** API response (golden fixture committed, see CONTRIBUTING)
- [ ] Descriptor/mapping registered declaratively (no special-casing scripts)

**Tests**
- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm -r test` passes (core + app unit tests)
- [ ] New tests added for the change (fixtures/assertions)

**Checklist**
- [ ] Commit messages follow existing conventions
- [ ] Docs updated if user-facing behavior changed
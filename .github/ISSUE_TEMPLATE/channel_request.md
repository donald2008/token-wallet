---
name: New channel request
about: Request a new platform quota channel (or expand an existing one)
title: "[channel] "
labels: enhancement
assignees: ''
---

**Platform & product**
Which platform and which plan/pricing product do you want tracked? (e.g. "Moonshot Kimi Pay-as-you-go balance")

**Official API access**
- Official API docs URL:
- Authentication: (API key / OAuth / CLI session / other)
- Access cost: (free endpoint? requires a paid plan? official CLI needed?)

**Usage semantics**
- What does the API return? (window used/total with reset time / remaining balance / percent only — be specific)
- Reset cadence: (5h rolling / daily / weekly / monthly / none — balance)
- Anything unusual: (HTTP always 200 with business code in body? percent is *remaining* not *used*? etc.)

**Verification**
Have you personally called this endpoint successfully? (yes/no — we only implement channels verified against a real response, see CONTRIBUTING)

**Extra**
Any sample response (redact keys) or third-party reference implementations.
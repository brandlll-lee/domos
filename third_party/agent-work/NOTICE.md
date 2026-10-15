Domos Bot work adapts the following Apache-2.0 reference implementations:

- Rakazo, Copyright 2026 Rakazo contributors. Bounded memory ordering in `packages/agent/src/work/memory.ts` adapts `packages/adapters/src/memory-context.ts`. Skill metadata and catalog behavior adapt `packages/core/src/agent-skill.ts`.
- OpenMausBot, Copyright 2026 Milind Soni and OpenMausBot contributors. Future calendar calculation in `packages/agent/src/work/schedule.ts` adapts `shared/routine-schedule.ts`. Skill format validation follows `shared/skill-md.ts`.

These implementations are modified for Domos: Pi documents replace reference storage; Pi tasks own scheduling; the YAML library reads skill frontmatter; original SKILL.md bytes remain intact. See the accompanying Apache-2.0 license.

Memoh informed the capability and prompt-section boundaries. This change includes no Memoh source code.

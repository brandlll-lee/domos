Domos Bot work adapts the following Apache-2.0 reference implementations:

- Rakazo, Copyright 2026 Rakazo contributors. Bounded memory ordering in `packages/agent/src/work/memory.ts` adapts `packages/adapters/src/memory-context.ts`. Skill metadata and catalog behavior adapt `packages/core/src/agent-skill.ts`.
- The Bot detail layout adapts Rakazo `apps/web/src/pages/ResizableSidePanel.tsx` and `pages/shell/bot-panel.tsx`: adjacent desktop settings, an overlaid narrow-screen panel, compact controls, and a centered avatar. Domos uses its existing theme and data interfaces.
- OpenMausBot, Copyright 2026 Milind Soni and OpenMausBot contributors. Future calendar calculation in `packages/agent/src/work/schedule.ts` adapts `shared/routine-schedule.ts`. Skill format validation follows `shared/skill-md.ts`.
- Bot detail focus entry and restoration adapt OpenMausBot `src/components/BotSettingsDialog.tsx`.
- Engine artwork in `apps/web/src/features/bots/engine-mark.tsx` adapts OpenMausBot `src/components/ProviderIcons.tsx`.
- Native extension request handling adapts OpenMausBot `server/drivers/pi.ts`. Structured approvals and Usage filters and detail rows adapt `src/components/PendingApproval.tsx` and `src/components/UsageHistory.tsx`. `apps/web/src/features/settings/usage-period.ts` reuses its UTC period calculation. These files are modified for Domos protocols, durable storage, controls, and themes.

These implementations are modified for Domos: Pi documents replace reference storage; Pi tasks own scheduling; the YAML library reads skill frontmatter; original SKILL.md bytes remain intact. See the accompanying Apache-2.0 license.

Memoh informed the capability and prompt-section boundaries. This change includes no Memoh source code.

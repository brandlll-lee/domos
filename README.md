<p align="center"><img src="packages/ui/assets/icon.png" width="88" alt="Domos" /></p>

# Domos

An AI team that lives on your computer.

Domos is an open-source AI team you can run yourself. Each teammate has a role, memory, and a place to work. They use tools, work with files, and run tasks on your schedule. Hand off the work and step away. They can keep working in the background and pick up where they left off.

Run Domos on your own computer or server. Keep it running, and your team stays ready around the clock.

**English** · [简体中文](README.zh-CN.md)

## What you can do

- Create Bots with their own names, instructions, models, and conversations.
- Keep chats, memory, skills, and scheduled tasks across restarts.
- Upload files, run commands, and download results.
- Choose a shared or separate work environment for each Bot.
- Connect other devices with a pairing code. Revoke access when needed.

Domos uses Pi and Pi Durable for model access and persistent Agent work.
Computer tools currently support commands and files. They do not control a graphical desktop.

## Get started

To run from source, install **Node.js 24+** and **pnpm 10.20.0**. Run these commands in the project folder:

```sh
pnpm install --frozen-lockfile
pnpm desktop
```

The desktop app guides you through three choices:

1. **Choose where Domos runs.** Use this computer, or enter the address of an existing Domos.
2. **Connect a model.** Sign in or enter a key in the app. Then name your first Bot.
3. **Choose where the Bot works.** Confirm access to files and commands. Domos prepares the selected environment.

On this computer, **Run directly** needs no Docker. **Run in Docker** needs a running Linux Docker engine. Domos prepares images only after you select a Docker option and continue. It does not install Docker or start WSL for you.

An existing Domos keeps its own Bots and chats. Pair this device to access them. The next launch restores your saved connection.

## Choose a work environment

The place that runs Domos and the place that runs Bot tasks are separate choices.

| Choice | Where the Bot works |
| --- | --- |
| Use the service environment | On the computer or inside the container that runs Domos |
| Share an isolated computer | In a Docker work container shared with other Bots |
| Use a separate isolated computer | In a Docker work container reserved for this Bot |

For an existing service, these choices refer to the **service's computer**, not this device. Isolated options are available when that service has a work environment configured.

Using the service environment gives the Bot the service account's system access. Separate folders in one environment do not provide isolation. Switching service modes keeps their data separate; it does not move chats or work files.

## Run in a browser

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open **http://127.0.0.1:4310**. Enter the first administrator code from `data/owner-code`. Connect a model in the app. You do not need to create an environment file.

Chats and credentials stay in the service's data folder. Credentials are encrypted at rest. One service process can use a data folder at a time.

For another device, use **Settings → General → Use on other devices**. Remote access requires HTTPS. See the [deployment guide](deploy/README.md) for server setup, permissions, and backups.

## Development

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium --only-shell
pnpm test:e2e
```

For web development, run `pnpm start` and `pnpm web` in separate terminals. Open the address shown by Vite. For terminal chat, run `pnpm chat`.

Build a desktop installer with `pnpm --filter @domos/desktop dist`. Output goes to `apps/desktop/release`. Local builds are unsigned.

| Folder | Purpose |
| --- | --- |
| `apps/desktop` | Desktop app and local service setup |
| `apps/web` | Chat, Bot settings, and onboarding |
| `apps/api` | Authenticated service and file access |
| `apps/controller` | Isolated computer lifecycle and transport |
| `packages/agent` | Persistent Agents, tools, and workspaces |
| `packages/ui` | Shared controls, theme, and identity |
| `packages/hosting` | Pairing, credentials, service setup, and backups |

Tests use temporary data and test models. The standard suite needs no model keys. Real container tests require Docker and run separately. See the [deployment guide](deploy/README.md#验收).

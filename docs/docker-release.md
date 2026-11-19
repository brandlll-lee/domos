# Docker releases

Release runs on a `v*` tag or a manual workflow dispatch. The tag must match `deploy/release.json`. Linux AMD64 and ARM64 runners build the service, workspace, and proxy images. Each runner tests the real containers before upload. The manifest job joins the tested platform images and writes their immutable digest references to `release.json`. Desktop packaging consumes that artifact. Image packages must allow anonymous reads. The workflow checks this before packaging.

The source manifest contains native development entry points. It does not identify published Docker images. Source builds support native startup. To build a Docker-enabled desktop, pass the generated release manifest to `pnpm --filter @domos/desktop exec node build.mjs <manifest>`. The build validates all three image digests. Client installation never builds images. Dockerfiles remain development and release inputs.

LocalStack downloads the required service image before it stops an existing backend. A cached digest needs no registry request. It checks the actual app and controller image IDs after readiness. Workspace and proxy images belong to the selected work environment. Existing work bindings retain their image, volume, directories and accounts until a confirmed rebuild.

Backend upgrades block new task admission and require idle tasks. After service shutdown, the data lease protects a sibling snapshot at `<installation>.upgrade`. The new backend starts in maintenance mode. It resumes tasks only after version and readiness checks succeed. An interrupted or failed upgrade restores the stopped snapshot and its compose file. Failed migrated data stays in `failed-data`. Recovery does not merge migrated data into an older schema. A backend that lacks the maintenance endpoint cannot upgrade while running.

Production release acceptance requires the container jobs. Unit tests and native desktop smoke do not verify Docker Desktop, image registry access, or Linux container input on a user's computer.

Native self-hosting uses `pnpm host --directory <installation> --release <release.json>`. The development Compose setup uses `sh deploy/install.sh <release.json>` and builds the service from source. Both use published work images and prepare work containers on demand.

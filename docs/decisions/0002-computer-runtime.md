# Computer runtime

Status: accepted.

Runtime configuration owns service paths, listen settings, deployment type, and the work computer target. API and CLI use the same assembly and shutdown path. Relative paths resolve at the configuration file. Model credentials stay in the service environment.

Pi Durable owns agent execution, history, recovery, and tools. Pi Env owns remote command and file transport. Domos binds an execution environment to each Bot. Connections are per Bot; the environment ID is shared by Bots on one computer. This preserves SDK file coordination and command cancellation boundaries.

The process target uses service permissions. The Docker target uses a separate Linux work container. Bots on one computer share permissions and files. Different isolation environments need distinct computer IDs and volumes. A Docker container shares the host kernel and is not a VM or a complete multi-tenant hosting service.

The computer module owns lifecycle and target inspection. Operations serialize within the instance and require idle Bots. Configuration is checked against actual container security, resources, mounts, and network. Bot tools do not receive control credentials. Rakazo supplies the adapted container configuration and host firewall. Source and license are in deploy/NOTICE.

Network is off by default. Restricted public egress requires a verified Linux host firewall. The control plane fails closed if the target or rules are unavailable. It does not run work on another target. Uncertain mutations are not automatically repeated. Each SDK connection controls its own processes. Stopping a work computer ends all of its processes.

Uploads and file tools use the selected environment. Published artifacts are durable service-side snapshots. Rebuilding the work container preserves its volume. Target changes require an explicit stopped migration. SQLite holds an exclusive runtime lock on a separate database for the lifetime of the service. The OS releases this lock on exit. Shared storage must support SQLite locking.

Computer status joins the existing contact subscription. API adapters transmit state; shared web views display the same value. Explicit checks and lifecycle actions read Docker state. No additional polling or independent browser status store is used.

Validation includes native tests, real Pi daemon transport tests, and opt-in Docker/SSH tests in CI. Container execution and isolation require real integration results. Mock tests alone do not certify those boundaries.

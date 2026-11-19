import { defineDoc } from "@earendil-works/pi-durable";

export const MaintenanceDoc = defineDoc<{ held: boolean }>({
  kind: "domos.maintenance",
  scope: "session",
  version: 1,
  checkpointWhen: () => false,
  initial: () => ({ held: false }),
});

import { useState } from "react";
import { PiProviderSettings } from "./pi-providers.tsx";
export function ProviderSettings(_props: { botId?: number }) {
  const [, setBusy] = useState(false);
  return <PiProviderSettings onBusyChange={setBusy} />;
}

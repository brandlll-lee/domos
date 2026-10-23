import type { ComputerActivity } from "@domos/agent/computer/activity";
import { mountComputerEffect } from "@domos/ui/computer-effect";
import { useEffect, useRef } from "react";

export function ComputerEffect({ state }: { state: ComputerActivity }) {
  const host = useRef<HTMLDivElement>(null);
  const effect = useRef<ReturnType<typeof mountComputerEffect>>(undefined);
  useEffect(() => {
    if (host.current) effect.current = mountComputerEffect(host.current);
    return () => effect.current?.close();
  }, []);
  useEffect(() => effect.current?.update(state), [state]);
  return <div ref={host} />;
}

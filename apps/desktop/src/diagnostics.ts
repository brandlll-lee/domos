import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export function diagnostics(directory: string) {
  const path = join(directory, "diagnostics", "service.log");
  return (event: Record<string, unknown>) => {
    try {
      mkdirSync(join(directory, "diagnostics"), { recursive: true });
      try {
        if (statSync(path).size >= 1024 * 1024) renameSync(path, `${path}.1`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      appendFileSync(
        path,
        `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`,
      );
    } catch {
      // Diagnostics must not interrupt service shutdown.
    }
  };
}

export function errorTrace(line: string) {
  const location = line.match(
    /^\s+at (?:.*? \()?((?:file:\/\/\/|[A-Za-z]:\\|\/)[^()]+:\d+:\d+)\)?$/,
  )?.[1];
  if (location) return location.replace(/[?#][^:]*?(?=:\d+:\d+$)/, "");
  return (
    line.match(/^(\w*Error)\b/)?.[1] ??
    line.match(/^\s*code: ['"]([A-Z_\d]+)['"]/)?.[1]
  );
}

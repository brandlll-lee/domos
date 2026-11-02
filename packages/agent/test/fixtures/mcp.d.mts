import type { ProductResult } from "../../src/harness/types.ts";
export function mcpFixture(options?: {
  oauth?: boolean;
  legacy?: boolean;
}): Promise<{
  url: string;
  result: ProductResult;
  calls: string[];
  started: Promise<void>;
  cancelled: Promise<void>;
  tokenRequests(): number;
  authorize(url: string): void;
  changeTools(names: string[]): Promise<void>;
  close(): Promise<void>;
}>;

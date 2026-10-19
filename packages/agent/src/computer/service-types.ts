import type { ProductResult, ProductTool } from "../harness/types.ts";

export type ComputerService = "browser" | "desktop";
export type ServiceState = {
  available: boolean;
  error: string | null;
};
export type ComputerRequest =
  | { operation: "catalog"; service: ComputerService }
  | { operation: "prepare"; service: ComputerService }
  | { operation: "install"; service: "browser" }
  | {
      operation: "call";
      service: ComputerService;
      name: string;
      arguments: Record<string, unknown>;
    };
export type ComputerResponse = ProductTool[] | ProductResult | ServiceState;

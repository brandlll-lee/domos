import type { ProductResult, ProductTool } from "../harness/types.ts";

export type ComputerService = "browser" | "desktop";
export type ServiceState = {
  available: boolean;
  error: string | null;
  mode?: "headless" | "headed";
};
export type ComputerRequest =
  | { operation: "settle"; service: "browser" }
  | { operation: "catalog"; service: ComputerService }
  | { operation: "prepare"; service: ComputerService }
  | { operation: "install"; service: "browser" }
  | { operation: "mode"; service: "browser"; mode: "headless" | "headed" }
  | {
      operation: "view";
      service: ComputerService;
      id: string;
      action: "open" | "next" | "send" | "close";
      message?: import("./viewer-types.ts").ViewerAction;
    }
  | {
      operation: "call";
      service: ComputerService;
      name: string;
      arguments: Record<string, unknown>;
      cursorColor?: string;
    };
export type ComputerResponse = ProductTool[] | ProductResult | ServiceState;

export function imageBaseUrl(value: string): string;
export type ImageRequestFailure = {
  outcome: "rejected" | "unknown" | "generated" | "not_sent";
  originalsAvailable: boolean | null;
  message: string;
  httpStatus?: number;
  provider?: {
    message: string;
    code?: string;
    param?: string;
    type?: string;
    requestId?: string;
  };
};
export function imageOperation(
  input: Record<string, unknown>,
  home: string,
  signal: AbortSignal,
): Promise<unknown>;

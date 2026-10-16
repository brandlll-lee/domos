export interface ComputerDriver {
  readonly config: {
    id: string;
    timeoutSeconds: number;
    network: "none" | "restricted" | "web";
  };
  readonly binding: object;
  readonly directory: string;
  inspect(): Promise<"running" | "stopped" | "missing">;
  checkNetwork(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  rebuild(): Promise<void>;
  daemon(): readonly string[] | Promise<readonly string[]>;
}

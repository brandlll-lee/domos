type Result<T = { message?: string }> = {
  ok: boolean;
  value?: T;
  error?: string;
};
export type DesktopState = {
  instances: {
    id: string;
    name: string;
    mode: "local" | "existing";
    unread?: number;
  }[];
  selected?: string;
  mode?: "local" | "existing";
  runtime?: "native" | "docker";
  running: boolean;
  service?: "starting" | "ready" | "recovering" | "stopped" | "failed";
};

declare global {
  interface Window {
    domosDesktop?: {
      platform: string;
      appearance(theme: "light" | "dark"): Promise<Result>;
      menu(scope?: "environment"): Promise<Result>;
      prepare(): Promise<Result<{ image: string; proxyImage?: string }>>;
      state(): Promise<Result<DesktopState>>;
      unread(count: number): Promise<Result>;
      notify(
        input: import("@domos/agent/chat-directory").ChatTarget & {
          sequence: number;
          title: string;
          body: string;
        },
      ): Promise<Result<{ shown: boolean }>>;
      connection(
        input:
          | { action: "select" | "remove"; id: string }
          | { action: "add" | "cancel" | "recover" },
      ): Promise<Result>;
      connected(): Promise<void>;
      pairing(): void;
      cancelConnection(): void;
      file(input: {
        action: "open" | "reveal" | "save";
        botId: number;
        id: string;
      }): Promise<Result<{ cancelled: boolean; localCopy?: boolean }>>;
      maintain(
        action: "backup" | "restore",
        password: string,
      ): Promise<Result<{ message: string }>>;
    };
  }
}

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
    url: string;
  }[];
  selected?: string;
  mode?: "local" | "existing";
  runtime?: "native" | "docker";
  running: boolean;
};

declare global {
  interface Window {
    domosDesktop?: {
      platform: string;
      appearance(theme: "light" | "dark"): Promise<Result>;
      menu(scope?: "environment"): Promise<Result>;
      prepare(): Promise<Result<{ image: string; proxyImage?: string }>>;
      state(): Promise<Result<DesktopState>>;
      maintain(
        action: "backup" | "restore",
        password: string,
      ): Promise<Result<{ message: string }>>;
    };
  }
}

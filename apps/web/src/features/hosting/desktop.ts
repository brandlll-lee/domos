type Result<T = { message?: string }> = {
  ok: boolean;
  value?: T;
  error?: string;
};
export type DesktopState = {
  mode?: "local" | "existing";
  runtime?: "native" | "docker";
  running: boolean;
};

declare global {
  interface Window {
    domosDesktop?: {
      platform: string;
      appearance(theme: "light" | "dark"): Promise<Result>;
      menu(): Promise<Result>;
      prepare(): Promise<Result<{ image: string; proxyImage?: string }>>;
      state(): Promise<Result<DesktopState>>;
      maintain(
        action: "backup" | "restore",
        password: string,
      ): Promise<Result<{ message: string }>>;
    };
  }
}

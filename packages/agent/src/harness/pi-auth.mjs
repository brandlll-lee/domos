import { join } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";

export default function (pi) {
  pi.registerCommand("domos-auth", {
    description: "Connect a native Pi provider",
    handler: async (_args, ctx) => {
      const notify = (value) =>
        ctx.ui.notify(`domos-auth:${JSON.stringify(value)}`, "info");
      try {
        const directory = getAgentDir();
        const runtime = await ModelRuntime.create({
          authPath: join(directory, "auth.json"),
          modelsPath: join(directory, "models.json"),
          refreshOnCreate: false,
        });
        const providers = runtime
          .getProviders()
          .filter(
            (provider) => provider.auth.apiKey?.login || provider.auth.oauth,
          );
        const id = await ctx.ui.select(
          "模型提供方",
          providers.map((provider) => provider.id),
        );
        const provider = providers.find((provider) => provider.id === id);
        if (!provider) throw new Error("Login cancelled");
        const methods = [
          ...(provider.auth.apiKey?.login
            ? [{ id: "api_key", label: provider.auth.apiKey.name }]
            : []),
          ...(provider.auth.oauth
            ? [{ id: "oauth", label: provider.auth.oauth.name }]
            : []),
        ];
        const label = await ctx.ui.select(
          "登录方式",
          methods.map((method) => method.label),
        );
        const method = methods.find((method) => method.label === label);
        if (!method) throw new Error("Login cancelled");
        await runtime.login(
          id,
          method.id,
          {
            notify,
            prompt: async (prompt) => {
              notify({ secret: prompt.type === "secret" });
              const value =
                prompt.type === "select"
                  ? await ctx.ui.select(
                      prompt.message,
                      prompt.options.map((option) => option.label),
                    )
                  : await ctx.ui.input(prompt.message, prompt.placeholder);
              if (value === undefined) throw new Error("Login cancelled");
              return prompt.type === "select"
                ? (prompt.options.find((option) => option.label === value)
                    ?.id ?? "")
                : value;
            },
          },
          { agentName: "Domos" },
        );
        notify({ state: "done" });
      } catch {
        notify({ state: "failed" });
      }
    },
  });
}

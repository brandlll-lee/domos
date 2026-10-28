import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { expect, test } from "vitest";
import { modelCatalog, modelProviders } from "../src/models.ts";

test("Pi providers include unconnected channels without disclosing credentials", async () => {
  const models = createModels();
  const connected = fauxProvider();
  models.setProvider(connected.provider);
  const pending = fauxProvider({ provider: "pending" });
  models.setProvider({
    ...pending.provider,
    name: "Pending",
    auth: {
      apiKey: {
        name: "API key",
        resolve: async () => undefined,
        login: async () => ({ type: "api_key", key: "test-only" }),
      },
    },
    refreshModels: async () => {},
  });
  expect(await modelProviders(models)).toEqual([
    { id: "faux", name: "faux", methods: [], configured: true, dynamic: false },
    {
      id: "pending",
      name: "Pending",
      methods: [{ type: "api_key", name: "API key" }],
      configured: false,
      dynamic: true,
    },
  ]);
  expect(
    (await modelCatalog(models)).every((model) => model.provider === "faux"),
  ).toBe(true);
});

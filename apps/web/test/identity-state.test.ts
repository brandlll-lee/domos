import { expect, test } from "vitest";
import {
  createIdentityState,
  equipmentFields,
  identityFields,
  type Profile,
} from "../src/features/bots/details/identity-state.ts";

function profile(patch: Partial<Profile> = {}): Profile {
  return {
    id: 1 as Profile["id"],
    name: "Domos",
    instructions: "Initial",
    avatar: "seed",
    avatarAssetId: "a",
    characterEquipment: undefined,
    avatarMedia: {
      src: "a.png",
      cover: "a.png",
      headset: { x: 50, y: 30, scale: 1 },
      computer: { x: 50, y: 48, scale: 1 },
    },
    avatarMigrationError: undefined,
    revision: 1,
    model: undefined,
    createdAt: undefined,
    ...patch,
  };
}

test("fresh profile fields merge with edits and identical changes settle", () => {
  const state = createIdentityState();
  state.receive(profile());
  state.change("name", "My name");
  state.receive(
    profile({
      revision: 2,
      instructions: "Remote instructions",
      avatarAssetId: "b",
    }),
  );
  expect(state.snapshot()).toMatchObject({
    values: {
      name: "My name",
      instructions: "Remote instructions",
      appearance: { avatarAssetId: "b" },
    },
    conflicts: [],
    dirty: ["name"],
  });
  state.receive(profile({ revision: 3, name: "My name" }));
  expect(state.snapshot().dirty).toEqual([]);
});

test.each(["current", "draft"] as const)(
  "conflicts keep their baseline until the user chooses %s",
  (choice) => {
    const state = createIdentityState();
    state.receive(profile());
    state.change("name", "Mine");
    state.receive(profile({ revision: 2, name: "Theirs" }));
    state.receive(
      profile({ revision: 3, name: "Theirs", instructions: "New" }),
    );
    expect(state.snapshot().conflicts).toEqual(["name"]);
    state.resolve("name", choice);
    expect(state.snapshot().conflicts).toEqual([]);
    expect(state.snapshot().values?.name).toBe(
      choice === "draft" ? "Mine" : "Theirs",
    );
  },
);

test("equipment edits require confirmation when the character changes", () => {
  const state = createIdentityState();
  state.receive(profile());
  state.change("headset", { x: 20, y: 30, scale: 1 });
  state.receive(profile({ revision: 2, avatarAssetId: "b" }));
  expect(state.snapshot().conflicts).toEqual(["headset"]);
  state.resolve("headset", "draft");
  expect(state.snapshot().conflicts).toEqual([]);
  state.receive(profile({ revision: 3, avatarAssetId: "c" }));
  expect(state.snapshot().conflicts).toEqual(["headset"]);
  state.resolve("headset", "current");
  expect(state.snapshot().values?.headset?.x).toBe(50);
});

test("equipment follows the selected character while other profile fields refresh", () => {
  const state = createIdentityState();
  state.receive(profile());
  state.change("appearance", { avatar: "next", avatarAssetId: "b" });
  const base = { x: 50, y: 30, scale: 0.64 };
  state.change("headset", { ...base, x: 27 }, base);
  state.receive(profile({ revision: 2, instructions: "Updated" }));
  expect(state.snapshot()).toMatchObject({
    values: {
      appearance: { avatar: "next", avatarAssetId: "b" },
      headset: { x: 27 },
      instructions: "Updated",
    },
    conflicts: [],
  });
  state.change("appearance", { avatar: "seed", avatarAssetId: "a" });
  expect(state.snapshot().conflicts).toEqual(["headset"]);
  expect(state.snapshot().values?.headset?.x).toBe(50);
  state.change("appearance", { avatar: "next", avatarAssetId: "b" });
  expect(state.snapshot().values?.headset?.x).toBe(27);
  expect(state.snapshot().conflicts).toEqual([]);
});

test("save acknowledgements clear only submitted edits and ignore older profiles", () => {
  const state = createIdentityState();
  state.receive(profile());
  state.change("name", "Mine");
  state.change("headset", { x: 20, y: 30, scale: 1 });
  const submitted = state.capture(equipmentFields);
  state.saved(
    profile({
      revision: 2,
      avatarMedia: {
        src: "a.png",
        cover: "a.png",
        computer: { x: 50, y: 48, scale: 1 },
        headset: { x: 20, y: 30, scale: 1 },
      },
    }),
    submitted,
  );
  expect(state.snapshot().dirty).toEqual(["name"]);
  state.receive(profile({ revision: 1, name: "Old" }));
  expect(state.snapshot().profile?.revision).toBe(2);
  const name = state.capture(identityFields);
  state.change("name", "Later edit");
  state.saved(profile({ revision: 3, name: "Mine" }), name);
  expect(state.snapshot().values?.name).toBe("Later edit");
  expect(state.snapshot().conflicts).toEqual([]);
  state.reset(identityFields);
  expect(state.snapshot().values?.name).toBe("Mine");
  expect(state.snapshot().dirty).toEqual([]);
});

test("a late save receipt clears confirmed edits while retaining newer server fields", () => {
  const state = createIdentityState();
  state.receive(profile());
  state.change("name", "Mine");
  const submitted = state.capture(identityFields);
  state.receive(profile({ revision: 3, instructions: "Newest" }));
  state.saved(profile({ revision: 2, name: "Mine" }), submitted);
  expect(state.snapshot().dirty).toEqual([]);
  expect(state.snapshot().values?.instructions).toBe("Newest");
  expect(state.snapshot().profile?.revision).toBe(3);
});

test("separate Bot and computer stores keep separate drafts", () => {
  const first = createIdentityState();
  first.receive(profile());
  first.change("name", "Draft");
  const second = createIdentityState();
  second.receive(profile({ name: "Second computer" }));
  expect(second.snapshot().values?.name).toBe("Second computer");
  expect(first.snapshot().values?.name).toBe("Draft");
});

test("editing a legacy character keeps an unspecified catalog reference distinct from a reset", () => {
  const state = createIdentityState();
  state.receive(profile({ avatarAssetId: undefined }));
  state.change("name", "Renamed");
  expect(state.snapshot().values?.appearance.avatarAssetId).toBeUndefined();
  state.change("appearance", { avatar: "seed", avatarAssetId: null });
  expect(state.snapshot().dirty).toContain("appearance");
});

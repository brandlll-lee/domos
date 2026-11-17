import type { CharacterMedia } from "@domos/ui/characters";
import type { client } from "../../../client.ts";

export type Profile = Awaited<ReturnType<typeof client.work.profile>>;
type Values = {
  name: string;
  instructions: string;
  appearance: { avatar: string; avatarAssetId: string | null | undefined };
  headset: CharacterMedia["headset"] | undefined;
  computer: CharacterMedia["computer"] | undefined;
};
export type IdentityField = keyof Values;
type Edit = {
  [K in IdentityField]: {
    field: K;
    base: Values[K];
    value: Values[K];
    owner?: string;
  };
}[IdentityField];
export const identityFields: IdentityField[] = [
  "name",
  "instructions",
  "appearance",
];
export const equipmentFields: IdentityField[] = ["headset", "computer"];
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const appearanceOf = (profile: Profile): Values["appearance"] => ({
  avatar: profile.avatar,
  avatarAssetId: profile.avatarAssetId,
});
const owner = (profile: Profile, appearance = appearanceOf(profile)) =>
  appearance.avatarAssetId === null
    ? undefined
    : (appearance.avatarAssetId ?? profile.avatarMedia?.src);
function valuesOf(
  profile: Profile,
  appearance = appearanceOf(profile),
): Values {
  const media =
    appearance.avatarAssetId === null
      ? undefined
      : appearance.avatarAssetId === profile.avatarAssetId
        ? profile.avatarMedia
        : profile.characterEquipment?.[appearance.avatarAssetId ?? ""];
  return {
    name: profile.name,
    instructions: profile.instructions,
    appearance,
    headset: media?.headset,
    computer: media?.computer,
  };
}

export function createIdentityState() {
  let profile: Profile | undefined;
  let edits: Edit[] = [];
  const appearance = () =>
    edits.find((edit) => edit.field === "appearance")?.value;
  const listeners = new Set<() => void>();
  const snapshot = () => {
    if (!profile)
      return {
        profile,
        values: undefined,
        conflicts: [] as IdentityField[],
        dirty: [] as IdentityField[],
      };
    const values = valuesOf(profile, appearance());
    const conflicts: IdentityField[] = [];
    for (const edit of edits) {
      const equipment = equipmentFields.includes(edit.field);
      const matchesOwner = edit.owner === owner(profile, values.appearance);
      const current =
        edit.field === "appearance"
          ? appearanceOf(profile)
          : (values[edit.field] ?? (matchesOwner ? edit.base : undefined));
      if (
        (!same(current, edit.base) && !same(current, edit.value)) ||
        (equipment && !matchesOwner)
      )
        conflicts.push(edit.field);
      if (!equipment || matchesOwner)
        Object.assign(values, { [edit.field]: edit.value });
    }
    return {
      profile,
      values,
      conflicts,
      dirty: edits.map((edit) => edit.field),
    };
  };
  let state = snapshot();
  const publish = () => {
    state = snapshot();
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    receive(value: Profile) {
      if (profile && value.revision < profile.revision) return;
      profile = value;
      const current = valuesOf(value, appearance());
      edits = edits.filter(
        (edit) =>
          !same(
            edit.value,
            edit.field === "appearance"
              ? appearanceOf(value)
              : current[edit.field],
          ) ||
          (equipmentFields.includes(edit.field) &&
            edit.owner !== owner(value, current.appearance)),
      );
      publish();
    },
    change<K extends IdentityField>(
      field: K,
      value: Values[K],
      base?: Values[K],
    ) {
      if (!profile) return;
      const current = valuesOf(profile, appearance());
      if (field === "appearance") current.appearance = appearanceOf(profile);
      const previous = edits.find((edit) => edit.field === field);
      edits = edits.filter((edit) => edit.field !== field);
      if (!same(value, current[field]))
        edits.push({
          field,
          base: previous?.base ?? current[field] ?? base,
          value,
          owner: previous?.owner ?? owner(profile, current.appearance),
        } as Edit);
      publish();
    },
    resolve(field: IdentityField, choice: "current" | "draft") {
      if (!profile) return;
      if (choice === "current")
        edits = edits.filter((edit) => edit.field !== field);
      else {
        const current = valuesOf(profile, appearance());
        if (field === "appearance") current.appearance = appearanceOf(profile);
        const currentOwner = owner(profile, current.appearance);
        edits = edits.map((edit) =>
          edit.field === field
            ? ({ ...edit, base: current[field], owner: currentOwner } as Edit)
            : edit,
        );
      }
      publish();
    },
    reset(selected: IdentityField[]) {
      edits = edits.filter((edit) => !selected.includes(edit.field));
      publish();
    },
    capture(selected: IdentityField[]) {
      return edits.filter((edit) => selected.includes(edit.field));
    },
    saved(value: Profile, submitted: Edit[]) {
      edits = edits.flatMap((edit) => {
        const sent = submitted.find((sent) => sent.field === edit.field);
        if (!sent) return [edit];
        return same(sent.value, edit.value)
          ? []
          : [{ ...edit, base: sent.value } as Edit];
      });
      if (profile && value.revision < profile.revision) publish();
      else this.receive(value);
    },
  };
}

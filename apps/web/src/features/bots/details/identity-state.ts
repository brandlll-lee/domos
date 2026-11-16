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
const owner = (profile: Profile) =>
  profile.avatarAssetId ?? profile.avatarMedia?.src;
function valuesOf(profile: Profile): Values {
  return {
    name: profile.name,
    instructions: profile.instructions,
    appearance: {
      avatar: profile.avatar,
      avatarAssetId: profile.avatarAssetId,
    },
    headset: profile.avatarMedia?.headset,
    computer: profile.avatarMedia?.computer,
  };
}

export function createIdentityState() {
  let profile: Profile | undefined;
  let edits: Edit[] = [];
  const listeners = new Set<() => void>();
  const snapshot = () => {
    if (!profile)
      return {
        profile,
        values: undefined,
        conflicts: [] as IdentityField[],
        dirty: [] as IdentityField[],
      };
    const values = valuesOf(profile);
    const conflicts: IdentityField[] = [];
    for (const edit of edits) {
      if (
        (!same(values[edit.field], edit.base) &&
          !same(values[edit.field], edit.value)) ||
        (equipmentFields.includes(edit.field) && edit.owner !== owner(profile))
      )
        conflicts.push(edit.field);
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
      const current = valuesOf(value);
      edits = edits.filter(
        (edit) =>
          !same(edit.value, current[edit.field]) ||
          (equipmentFields.includes(edit.field) && edit.owner !== owner(value)),
      );
      publish();
    },
    change<K extends IdentityField>(field: K, value: Values[K]) {
      if (!profile) return;
      const current = valuesOf(profile);
      const previous = edits.find((edit) => edit.field === field);
      edits = edits.filter((edit) => edit.field !== field);
      if (!same(value, current[field]))
        edits.push({
          field,
          base: previous?.base ?? current[field],
          value,
          owner: previous?.owner ?? owner(profile),
        } as Edit);
      publish();
    },
    resolve(field: IdentityField, choice: "current" | "draft") {
      if (!profile) return;
      if (choice === "current")
        edits = edits.filter((edit) => edit.field !== field);
      else {
        const current = valuesOf(profile);
        const currentOwner = owner(profile);
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

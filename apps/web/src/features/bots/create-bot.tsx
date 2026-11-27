import type { Bot } from "@domos/agent/bots";
import { BOT_NAME_LENGTH } from "@domos/agent/work/limits";
import { type CharacterMedia, characterSeed } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Dialog, DialogFooter } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { InlineNotice } from "@domos/ui/message";
import { useRef, useState } from "react";
import { client } from "../../client.ts";
import { rejectionMessage } from "../chat/request-error.ts";
import {
  AvatarEditor,
  IdentityPreview,
  useCharacterMedia,
} from "./avatar-editor.tsx";
import { useCustomColors } from "./color-preferences.ts";
import { AvatarEquipment } from "./details/avatar-equipment.tsx";
import { ModelSetup } from "./details/model.tsx";

type Page = "identity" | "appearance" | "equipment" | "model";
const titles = {
  identity: "新建 Bot",
  appearance: "外观",
  equipment: "装备位置",
  model: "选择模型",
};

export function CreateBot({
  finalFocus,
  onCreated,
  open,
  onOpenChange,
}: {
  finalFocus: () => HTMLElement | null;
  onCreated: (bot: Bot) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState<Page>("identity");
  return (
    <Dialog
      finalFocus={finalFocus}
      open={open}
      layout="task"
      className="create-bot-dialog"
      title={titles[page]}
      onOpenChange={(value) => {
        if (!saving) onOpenChange(value);
      }}
      onOpenChangeComplete={(value) => {
        if (!value) setPage("identity");
      }}
      onBack={
        page === "appearance" || page === "equipment"
          ? () => setPage(page === "equipment" ? "appearance" : "identity")
          : undefined
      }
      backDisabled={saving}
    >
      <BotForm
        page={page}
        onPageChange={setPage}
        saving={saving}
        onSavingChange={setSaving}
        onCancel={() => onOpenChange(false)}
        onCreated={(bot) => {
          onOpenChange(false);
          onCreated(bot);
        }}
      />
    </Dialog>
  );
}

function BotForm({
  page,
  onPageChange,
  saving,
  onSavingChange,
  onCancel,
  onCreated,
}: {
  page: Page;
  onPageChange: (page: Page) => void;
  saving: boolean;
  onSavingChange: (saving: boolean) => void;
  onCancel: () => void;
  onCreated: (bot: Bot) => void;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(characterSeed);
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null);
  const [colors, setColors] = useCustomColors();
  const [equipment, setEquipment] = useState<
    Record<string, Pick<CharacterMedia, "headset" | "computer">>
  >({});
  const { source, data } = useCharacterMedia(undefined, avatarAssetId);
  const positions = avatarAssetId ? equipment[avatarAssetId] : undefined;
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Bot>();
  const request = useRef<{
    id: string;
    equipmentId: string;
    payload: string;
    equipment?: Parameters<typeof client.work.update>[0];
  } | null>(null);
  if (created)
    return (
      <ModelSetup
        botId={created.id}
        onBusyChange={onSavingChange}
        onReady={() => onCreated(created)}
      />
    );
  return (
    <form
      id="create-bot"
      className="form-fields create-bot-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim() || saving) return;
        const input = {
          name: name.trim(),
          avatar,
          avatarAssetId: avatarAssetId ?? undefined,
        };
        const payload = JSON.stringify({ ...input, positions });
        if (request.current?.payload !== payload)
          request.current = {
            id: crypto.randomUUID(),
            equipmentId: crypto.randomUUID(),
            payload,
          };
        onSavingChange(true);
        setError(null);
        try {
          let bot = await client.bots.create({
            ...input,
            requestId: request.current.id,
          });
          if (source && positions) {
            if (!request.current.equipment) {
              const profile = await client.work.profile({ botId: bot.id });
              request.current.equipment = {
                botId: bot.id,
                name: bot.name,
                avatar,
                avatarAssetId,
                instructions: profile.instructions,
                revision: profile.revision,
                ...positions,
                requestId: request.current.equipmentId,
              };
            }
            const updated = await client.work.update(request.current.equipment);
            bot = { ...bot, ...updated };
          }
          setCreated(bot);
          onPageChange("model");
        } catch (cause) {
          setError(
            rejectionMessage(cause) ?? "创建未确认。请重试，系统会核对原请求。",
          );
        } finally {
          onSavingChange(false);
        }
      }}
    >
      <fieldset disabled={saving} className="bot-fields">
        {page === "identity" ? (
          <>
            <IdentityPreview
              name={name}
              avatar={avatar}
              media={source}
              onEdit={() => onPageChange("appearance")}
            />
            <TextField
              label="名字"
              labelClassName="sr-only"
              placeholder="给伙伴取个名字"
              value={name}
              onValueChange={setName}
              required
              maxLength={BOT_NAME_LENGTH}
              autoFocus
            />
          </>
        ) : page === "appearance" ? (
          <AvatarEditor
            value={avatar}
            assetId={avatarAssetId}
            source={source}
            characters={data}
            onAssetChange={setAvatarAssetId}
            onChange={setAvatar}
            onEquipment={() => onPageChange("equipment")}
            colors={colors}
            onColorsChange={setColors}
          />
        ) : (
          source &&
          avatarAssetId && (
            <AvatarEquipment
              avatar={avatar}
              source={source}
              headset={positions?.headset ?? source.headset}
              computer={positions?.computer ?? source.computer}
              onChange={(field, value) =>
                setEquipment((current) => ({
                  ...current,
                  [avatarAssetId]: {
                    headset: positions?.headset ?? source.headset,
                    computer: positions?.computer ?? source.computer,
                    [field]: value,
                  },
                }))
              }
            />
          )
        )}
      </fieldset>
      {error && (
        <div role="alert">
          <InlineNotice>{error}</InlineNotice>
        </div>
      )}
      <DialogFooter>
        <div className="dialog-actions">
          {page === "identity" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={saving}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="create-bot"
                pending={saving}
                disabled={!name.trim()}
              >
                创建并选择模型
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={() =>
                onPageChange(page === "equipment" ? "appearance" : "identity")
              }
            >
              完成
            </Button>
          )}
        </div>
      </DialogFooter>
    </form>
  );
}

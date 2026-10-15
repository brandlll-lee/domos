import type { Bot, BotPresence } from "@domos/agent/bots";
import type { ChatView } from "@domos/agent/view";
import { SearchPicker } from "@domos/ui/picker";
import { AppearancePicker } from "../appearance/picker.tsx";
import { CreateBot } from "../bots/create-bot.tsx";
import { selectBot } from "../bots/use-bots.ts";
import { ModelPicker } from "./model-picker.tsx";

export function ChatSettings({
  bot,
  bots,
  model,
  connected,
}: {
  bot: Bot;
  bots: BotPresence[];
  model: ChatView["model"];
  connected: boolean;
}) {
  return (
    <section className="chat-settings" aria-label="对话设置">
      <div className="mobile-contacts">
        <SearchPicker
          label="联系人"
          searchLabel="搜索联系人…"
          emptyLabel="没有找到联系人"
          placeholder={bot.name}
          items={bots.map((item) => ({
            value: String(item.id),
            label: item.name,
          }))}
          value={String(bot.id)}
          onValueChange={(value) => {
            const selected = bots.find((item) => String(item.id) === value);
            if (selected) selectBot(selected);
          }}
        />
        <CreateBot model={model} onCreated={selectBot} />
      </div>
      <div className="chat-setting">
        <span>模型</span>
        <ModelPicker botId={bot.id} model={model} connected={connected} />
      </div>
      <div className="chat-setting">
        <span>外观</span>
        <AppearancePicker />
      </div>
    </section>
  );
}

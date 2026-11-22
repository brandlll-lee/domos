import type { BotPresence } from "@domos/agent/bots";
import type { PrivateConversation } from "@domos/agent/conversations";
import { BotAvatar } from "@domos/ui/avatar";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { SearchField, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { StatusDot } from "@domos/ui/status-dot";
import { Tabs } from "@domos/ui/tabs";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { HandPalmIcon } from "@phosphor-icons/react/dist/csr/HandPalm";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useState } from "react";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { flushModelSettings } from "../models/model-state.ts";
import { useErrorNotice } from "../notices.tsx";
import { useAttention } from "./attention.tsx";
import { contactTime } from "./format.ts";
import { useCommandSelection } from "./use-command-selection.ts";

export const conversationRoute = (botId: number, id: number) =>
  id === botId ? `bot/${botId}` : `bot/${botId}/${id}`;
export function selectConversation(botId: number, id: number) {
  window.location.hash = `bot/${botId}/${id}`;
}
export async function createConversation(
  botId: number,
  source: number,
  requestId: string,
) {
  await flushModelSettings(source);
  const conversation = await client.conversations.create({
    botId,
    source,
    requestId,
  });
  selectConversation(botId, conversation.id);
}

const conversationStatus = {
  working: { label: "工作中", Icon: DotsThreeIcon },
  queued: { label: "排队中", Icon: ClockIcon },
  waiting: { label: "等待处理", Icon: HandPalmIcon },
  failed: { label: "失败", Icon: XIcon },
};

export function ConversationState({
  status,
  updatedAt,
  unread,
  now,
}: {
  status: PrivateConversation["status"];
  updatedAt?: number;
  unread: number;
  now: number;
}) {
  const mark = status === "idle" ? undefined : conversationStatus[status];
  const label = [mark?.label, unread > 0 && "未读"].filter(Boolean).join("，");
  return (
    <>
      {label && (
        <span
          className="conversation-status"
          data-status={status}
          title={label}
        >
          {mark ? (
            <mark.Icon role="img" aria-label={label} />
          ) : (
            <StatusDot tone="positive" label={label} />
          )}
        </span>
      )}
      {updatedAt && (
        <time dateTime={new Date(updatedAt).toISOString()}>
          {contactTime(updatedAt, now)}
        </time>
      )}
    </>
  );
}

export function ConversationsDialog({
  bot,
  current,
  open,
  onOpenChange,
}: {
  bot: BotPresence;
  current: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("active");
  const [editing, setEditing] = useState<PrivateConversation>();
  const [title, setTitle] = useState("");
  const action = useWorkAction();
  useErrorNotice(action.error);
  const attention = useAttention();
  const items = (bot.conversations ?? []).filter(
    (item) =>
      item.archived === (tab === "archived") &&
      item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const command = useCommandSelection(
    items.map((item) => String(item.id)),
    `${open}:${bot.id}:${query}:${tab}`,
    String(current),
  );
  const now = Date.now();
  return (
    <Dialog
      className="chat-command-dialog conversations-dialog"
      title={
        editing ? (
          "会话名称"
        ) : (
          <span className="conversation-dialog-identity">
            <BotAvatar botId={bot.id} seed={bot.avatar} />
            <span>{bot.name} 的会话</span>
          </span>
        )
      }
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={command.onOpenChangeComplete}
      initialFocus={editing ? undefined : () => command.input.current}
      headerActions={
        !editing && (
          <Button
            size="small"
            variant="ghost"
            pending={action.busy}
            onClick={() =>
              void action.run("create", async (requestId) => {
                await createConversation(bot.id, current, requestId);
                onOpenChange(false);
              })
            }
          >
            新建会话
          </Button>
        )
      }
      subheader={
        !editing && (
          <div className="command-controls">
            <SearchField
              inputRef={command.input}
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={query}
              onValueChange={setQuery}
              {...command.inputProps}
            />
            <Tabs.Root value={tab} onValueChange={setTab}>
              <Tabs.List className="command-tabs" aria-label="会话范围">
                <Tabs.Tab className="navigation-tab" value="active">
                  活跃
                </Tabs.Tab>
                <Tabs.Tab className="navigation-tab" value="archived">
                  已归档
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.Root>
          </div>
        )
      }
      footer={
        editing ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(undefined)}>
              取消
            </Button>
            <Button
              disabled={!title.trim()}
              pending={action.busy}
              onClick={() =>
                void action.run("rename", async () => {
                  await client.conversations.update({
                    botId: bot.id,
                    id: editing.id,
                    title,
                  });
                  setEditing(undefined);
                })
              }
            >
              保存
            </Button>
          </>
        ) : (
          <span className="chat-search-hint">
            ↑↓ 选择　Enter 打开　Esc 关闭
          </span>
        )
      }
    >
      {editing ? (
        <TextField
          label="名称"
          value={title}
          onValueChange={setTitle}
          maxLength={80}
          autoFocus
        />
      ) : (
        <table
          className="conversation-list command-results"
          {...command.listProps}
          aria-label="会话"
        >
          <tbody>
            {items.map((item) => (
              <tr
                className="conversation-list-row command-row"
                key={item.id}
                {...command.rowProps(String(item.id))}
              >
                <td className="command-main-cell">
                  <Button
                    variant="ghost"
                    className="conversation-row"
                    data-command-action
                    aria-current={item.id === current ? "page" : undefined}
                    onKeyDown={command.keyDown}
                    onClick={() => {
                      selectConversation(bot.id, item.id);
                      onOpenChange(false);
                    }}
                  >
                    <span className="conversation-row-title">{item.title}</span>
                    <ConversationState
                      status={item.status}
                      updatedAt={item.updatedAt}
                      unread={
                        attention?.counts[conversationRoute(bot.id, item.id)] ??
                        0
                      }
                      now={now}
                    />
                  </Button>
                </td>
                <td className="command-row-actions">
                  <ActionMenu
                    label="会话操作"
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon-small"
                        aria-label={`${item.title}的操作`}
                      >
                        <DotsThreeIcon />
                      </Button>
                    }
                    items={[
                      {
                        label: "重命名",
                        onSelect: () => {
                          setTitle(item.title);
                          setEditing(item);
                        },
                      },
                      {
                        label: item.archived ? "恢复会话" : "归档",
                        onSelect: () =>
                          void action.run(["archive", item.id], () =>
                            client.conversations.update({
                              botId: bot.id,
                              id: item.id,
                              archived: !item.archived,
                            }),
                          ),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={2} className="sidebar-empty">
                  没有匹配的会话
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}

import type { BotPresence } from "@domos/agent/bots";
import type { PrivateConversation } from "@domos/agent/conversations";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { Checkbox, SearchField, TextField } from "@domos/ui/field";
import { ActionMenu } from "@domos/ui/menu";
import { Pagination } from "@domos/ui/pagination";
import { StatusDot } from "@domos/ui/status-dot";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { useState } from "react";
import { client } from "../../client.ts";
import { useWorkAction } from "../bots/details/use-bot-work.ts";
import { flushModelSettings } from "../models/model-state.ts";
import { useErrorNotice } from "../notices.tsx";
import { useAttention } from "./attention.tsx";
import { contactTime } from "./format.ts";

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

export function ConversationState({
  item,
  unread,
  now,
}: {
  item: PrivateConversation;
  unread: number;
  now: number;
}) {
  const label = {
    working: "工作中",
    queued: "排队中",
    waiting: "等待处理",
    failed: "失败",
    idle: "",
  }[item.status];
  return (
    <span className="conversation-state">
      {(label || unread > 0) && (
        <StatusDot
          tone={
            item.status === "failed"
              ? "negative"
              : item.status === "waiting" || item.status === "queued"
                ? "warning"
                : "positive"
          }
          label={label || "未读"}
        />
      )}
      {label ||
        (unread ? (
          "未读"
        ) : item.updatedAt ? (
          <time dateTime={new Date(item.updatedAt).toISOString()}>
            {contactTime(item.updatedAt, now)}
          </time>
        ) : (
          ""
        ))}
    </span>
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
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PrivateConversation>();
  const [title, setTitle] = useState("");
  const action = useWorkAction();
  useErrorNotice(action.error);
  const attention = useAttention();
  const items = (bot.conversations ?? []).filter(
    (item) =>
      item.archived === archived &&
      item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(items.length / 12)));
  const now = Date.now();
  return (
    <Dialog
      title={editing ? "会话名称" : `${bot.name}的会话`}
      open={open}
      onOpenChange={onOpenChange}
      headerActions={
        !editing && (
          <Button
            size="small"
            variant="secondary"
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
          <div className="conversation-controls">
            <SearchField
              aria-label="搜索会话"
              placeholder="搜索会话"
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
            />
            <Checkbox
              label="已归档"
              checked={archived}
              onCheckedChange={(value) => {
                setArchived(value);
                setPage(1);
              }}
            />
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
          <Pagination
            label="会话分页"
            page={currentPage}
            pageSize={12}
            total={items.length}
            onPage={setPage}
          />
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
        <div className="conversation-list">
          {items.slice((currentPage - 1) * 12, currentPage * 12).map((item) => (
            <div className="conversation-list-row" key={item.id}>
              <Button
                variant="ghost"
                className="conversation-row"
                aria-current={item.id === current ? "page" : undefined}
                onClick={() => {
                  selectConversation(bot.id, item.id);
                  onOpenChange(false);
                }}
              >
                <span className="conversation-row-title">{item.title}</span>
                <ConversationState
                  item={item}
                  unread={
                    attention?.counts[conversationRoute(bot.id, item.id)] ?? 0
                  }
                  now={now}
                />
              </Button>
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
            </div>
          ))}
          {!items.length && <p className="sidebar-empty">没有匹配的会话</p>}
        </div>
      )}
    </Dialog>
  );
}

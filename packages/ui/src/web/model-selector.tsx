import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "./controls.tsx";
import { TextField } from "./field.tsx";
import { ScrollArea } from "./scroll-area.tsx";

export function ModelSelector({
  open,
  onOpenChange,
  providers,
  models,
  provider,
  effort,
  status,
  notice,
  configuration,
  value,
  label,
  loading,
  disabled,
  busy,
  error,
  onProviderChange,
  onSelect,
  onConfigure,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: {
    id: string;
    name: string;
    icon: ReactNode;
    configured: boolean;
  }[];
  models: { id: string; name: string; group?: string }[];
  provider: string;
  effort?: ReactNode;
  status?: string;
  notice?: ReactNode;
  configuration?: ReactNode;
  value: string;
  label: string;
  loading: boolean;
  disabled: boolean;
  busy?: boolean;
  error?: string | null;
  onProviderChange: (id: string) => void;
  onSelect: (id: string) => void;
  onConfigure?: () => void;
}) {
  const [query, setQuery] = useState("");
  const popup = useRef<HTMLDivElement>(null);
  const selected = providers.find((item) => item.id === provider);
  const matches = models.filter((item) =>
    `${item.name} ${item.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setQuery("");
        onOpenChange(next);
      }}
    >
      <Popover.Trigger
        render={
          <Button
            variant="ghost"
            size="small"
            className="model-selector-trigger"
            aria-label="模型"
            role="combobox"
            disabled={disabled}
          />
        }
      >
        <span className="model-selector-label">{label}</span>
        <svg
          className="model-selector-chevron"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="model-selector-positioner"
        >
          <Popover.Popup
            ref={popup}
            className="model-selector-popup"
            initialFocus={(interaction) =>
              interaction === "keyboard"
                ? popup.current?.querySelector<HTMLInputElement>(
                    'input[type="search"]',
                  )
                : true
            }
          >
            <Popover.Title className="sr-only">选择模型</Popover.Title>
            <Tabs.Root
              value={provider}
              orientation="vertical"
              className="model-selector-content"
              onValueChange={(id) => {
                setQuery("");
                onProviderChange(String(id));
              }}
            >
              <Tabs.List
                className="model-selector-rail"
                aria-label="模型提供方"
              >
                {providers.map((item) => (
                  <Tabs.Tab
                    key={item.id}
                    value={item.id}
                    className="model-selector-provider"
                    aria-label={item.name}
                    title={`${item.name} · ${item.configured ? "已连接" : "未连接"}`}
                    data-connected={item.configured || undefined}
                    disabled={busy}
                  >
                    {item.icon}
                  </Tabs.Tab>
                ))}
                {onConfigure && (
                  <Button
                    variant="ghost"
                    size="icon-small"
                    className="model-selector-config"
                    aria-label="连接与账号设置"
                    title="连接与账号设置"
                    disabled={busy || disabled}
                    onClick={onConfigure}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M4 5h12M4 10h12M4 15h12M7 3v4m6 1v4m-5 1v4" />
                    </svg>
                  </Button>
                )}
              </Tabs.List>
              <Tabs.Panel value={provider} className="model-selector-panel">
                <div className="model-selector-header">
                  <div className="model-selector-identity">
                    <strong>{selected?.name}</strong>
                    {status && <span title={status}>{status}</span>}
                  </div>
                </div>
                {configuration ?? (
                  <>
                    {notice}
                    <div className="model-selector-search">
                      <TextField
                        label="搜索模型…"
                        type="search"
                        placeholder={
                          selected?.name ? `搜索 ${selected.name}` : "搜索模型"
                        }
                        value={query}
                        onValueChange={setQuery}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            popup.current
                              ?.querySelector<HTMLButtonElement>(
                                '[role="option"]:not(:disabled)',
                              )
                              ?.focus();
                          }
                        }}
                      />
                      <Popover.Close
                        aria-label="关闭模型选择"
                        render={<Button variant="ghost" size="icon-small" />}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m4 4 8 8m0-8-8 8" />
                        </svg>
                      </Popover.Close>
                    </div>
                    <ScrollArea className="model-selector-scroll">
                      <div
                        className="model-selector-options"
                        role="listbox"
                        aria-label="可用模型"
                        onKeyDown={(event) => {
                          if (
                            !["ArrowDown", "ArrowUp", "Home", "End"].includes(
                              event.key,
                            )
                          )
                            return;
                          const items = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>(
                              'button[role="option"]:not(:disabled)',
                            ),
                          );
                          const index = items.indexOf(
                            document.activeElement as HTMLButtonElement,
                          );
                          const next =
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? items.length - 1
                                : Math.max(
                                    0,
                                    Math.min(
                                      items.length - 1,
                                      index +
                                        (event.key === "ArrowDown" ? 1 : -1),
                                    ),
                                  );
                          event.preventDefault();
                          items[next]?.focus();
                        }}
                      >
                        {loading ? (
                          <p role="status">正在读取模型…</p>
                        ) : (
                          matches.map((item, index) => (
                            <div key={item.id}>
                              {item.group &&
                                item.group !== matches[index - 1]?.group && (
                                  <p className="model-selector-group">
                                    {item.group}
                                  </p>
                                )}
                              <button
                                type="button"
                                className="model-selector-option"
                                role="option"
                                aria-label={`${selected?.name} · ${item.name}`}
                                aria-selected={item.id === value}
                                disabled={disabled || busy}
                                onClick={() => onSelect(item.id)}
                              >
                                <span>{item.name}</span>
                                {item.id === value && (
                                  <svg
                                    className="model-selector-check"
                                    viewBox="0 0 16 16"
                                    aria-hidden="true"
                                  >
                                    <path d="m3 8 3 3 7-7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          ))
                        )}
                        {!loading && !matches.length && (
                          <p>
                            {models.length ? "没有找到模型" : "暂无可用模型"}
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                    {busy && !loading && (
                      <p className="model-selector-note">工作结束后可切换</p>
                    )}
                    {effort}
                  </>
                )}
                {error && (
                  <p className="alert" role="alert">
                    {error}
                  </p>
                )}
              </Tabs.Panel>
            </Tabs.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

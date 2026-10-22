import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { type ReactNode, useState } from "react";
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
  providers: { id: string; name: string; icon: ReactNode }[];
  models: { id: string; name: string; group?: string }[];
  provider: string;
  effort?: ReactNode;
  value: string;
  label: string;
  loading: boolean;
  disabled: boolean;
  busy?: boolean;
  error?: string | null;
  onProviderChange: (id: string) => void;
  onSelect: (id: string) => void;
  onConfigure: () => void;
}) {
  const [query, setQuery] = useState("");
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
            aria-label="选择引擎与模型"
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
          <Popover.Popup className="model-selector-popup">
            <Popover.Title className="sr-only">任务引擎与模型</Popover.Title>
            <Tabs.Root
              value={provider}
              orientation="vertical"
              className="model-selector-content"
              onValueChange={(id) => {
                setQuery("");
                onProviderChange(String(id));
              }}
            >
              <Tabs.List className="model-selector-rail" aria-label="任务引擎">
                {providers.map((item) => (
                  <Tabs.Tab
                    key={item.id}
                    value={item.id}
                    className="model-selector-provider"
                    aria-label={item.name}
                    title={item.name}
                  >
                    {item.icon}
                  </Tabs.Tab>
                ))}
                <Button
                  variant="ghost"
                  size="icon-small"
                  className="model-selector-config"
                  aria-label="连接与账号设置"
                  title="连接与账号设置"
                  onClick={onConfigure}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M4 5h12M4 10h12M4 15h12M7 3v4m6 1v4m-5 1v4" />
                  </svg>
                </Button>
              </Tabs.List>
              <Tabs.Panel value={provider} className="model-selector-panel">
                <div className="model-selector-search">
                  <TextField
                    label="搜索模型"
                    type="search"
                    placeholder={
                      selected?.name ? `搜索 ${selected.name}` : "搜索模型"
                    }
                    value={query}
                    onValueChange={setQuery}
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
                  <div className="model-selector-options">
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
                            aria-pressed={item.id === value}
                            disabled={disabled}
                            onClick={() => onSelect(item.id)}
                          >
                            <span>{item.name}</span>
                            {item.id === value && (
                              <span
                                className="model-selector-check"
                                aria-hidden="true"
                              >
                                ✓
                              </span>
                            )}
                          </button>
                        </div>
                      ))
                    )}
                    {!loading && !matches.length && (
                      <p>
                        {models.length ? "没有找到模型" : "连接账号后选择模型"}
                      </p>
                    )}
                  </div>
                </ScrollArea>
                {busy && !loading && (
                  <p className="model-selector-note">工作结束后可切换</p>
                )}
                {error && (
                  <p className="alert" role="alert">
                    {error}
                  </p>
                )}
                {effort}
              </Tabs.Panel>
            </Tabs.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

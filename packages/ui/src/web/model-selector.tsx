import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { Button } from "./controls.tsx";
import { ChoicePicker } from "./picker.tsx";
import { ScrollArea } from "./scroll-area.tsx";

export type Provider = {
  id: string;
  name: string;
  icon?: ReactNode;
};

export type Model = {
  id: string;
  name: string;
  provider: string;
};

export function ModelSelector({
  providers,
  models,
  selectedProvider,
  selectedModel,
  onProviderChange,
  onModelChange,
  onConfigClick,
}: {
  providers: Provider[];
  models: Model[];
  selectedProvider: string;
  selectedModel: string;
  onProviderChange: (id: string) => void;
  onModelChange: (id: string) => void;
  onConfigClick: () => void;
}) {
  const currentProvider = providers.find((p) => p.id === selectedProvider);
  const currentModel = models.find((m) => m.id === selectedModel);
  const providerModels = models.filter((m) => m.provider === selectedProvider);

  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            size="small"
            className="model-selector-trigger"
            title="选择模型"
          >
            <span className="model-selector-label">
              {currentModel?.name || "选择模型"}
            </span>
            <svg
              className="model-selector-icon"
              viewBox="0 0 16 16"
              aria-hidden="true"
            >
              <path d="m5.5 6 2.5-2.5L10.5 6m-5 4 2.5 2.5 2.5-2.5" />
            </svg>
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="model-selector-popup">
          <header className="model-selector-header">
            <Dialog.Title className="dialog-title">
              任务引擎与模型
            </Dialog.Title>
            <Dialog.Close
              render={
                <Button variant="ghost" size="icon-small" aria-label="关闭" />
              }
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </Dialog.Close>
          </header>

          <div className="model-selector-content">
            <Tabs.Root
              defaultValue="providers"
              className="model-selector-tabs"
            >
              <Tabs.List className="model-selector-tab-list">
                <Tabs.Tab
                  value="providers"
                  className="model-selector-tab"
                  aria-label="任务引擎"
                >
                  任务引擎
                </Tabs.Tab>
                <Tabs.Tab
                  value="models"
                  className="model-selector-tab"
                  aria-label="对话模型"
                >
                  对话模型
                </Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel
                value="providers"
                className="model-selector-panel"
              >
                <ScrollArea className="model-selector-scroll">
                  <div className="model-selector-grid">
                    {providers.map((provider) => (
                      <button
                        key={provider.id}
                        className="model-selector-item"
                        data-selected={
                          selectedProvider === provider.id || undefined
                        }
                        onClick={() => onProviderChange(provider.id)}
                      >
                        {provider.icon && (
                          <span className="model-selector-item-icon">
                            {provider.icon}
                          </span>
                        )}
                        <span className="model-selector-item-name">
                          {provider.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </Tabs.Panel>

              <Tabs.Panel value="models" className="model-selector-panel">
                <ScrollArea className="model-selector-scroll">
                  <div className="model-selector-grid">
                    {providerModels.map((model) => (
                      <button
                        key={model.id}
                        className="model-selector-item"
                        data-selected={
                          selectedModel === model.id || undefined
                        }
                        onClick={() => onModelChange(model.id)}
                      >
                        <span className="model-selector-item-name">
                          {model.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </Tabs.Panel>
            </Tabs.Root>
          </div>

          <footer className="model-selector-footer">
            <Button
              variant="secondary"
              onClick={onConfigClick}
            >
              详细配置
            </Button>
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

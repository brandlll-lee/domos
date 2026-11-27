import { characterColors } from "@domos/ui/characters";
import { Button } from "@domos/ui/controls";
import { Popover } from "@domos/ui/popover";
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Hsv, hexOf, hsvHex, hsvOf, rgbOf } from "../color.ts";
import "./color-picker.css";

function CloseMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}

function Swatch({
  color,
  selected,
  onClick,
  label,
}: {
  color?: string;
  selected?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="color-swatch"
      aria-label={label}
      aria-pressed={!!selected}
      title={label}
      onClick={onClick}
      style={{ backgroundColor: color }}
      data-empty={!color || undefined}
    />
  );
}

function CustomColors({
  colors,
  selected,
  onPick,
  onAdd,
}: {
  colors: string[];
  selected: string;
  onPick: (color: string) => void;
  onAdd: (index: number) => void;
}) {
  return (
    <fieldset className="color-swatches" aria-label="自定义颜色">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"].map(
        (slot) => {
          const index = Number(slot) - 1;
          return (
            <Swatch
              key={slot}
              color={colors[index]}
              selected={colors[index] === selected}
              label={
                colors[index]
                  ? `自定义色 ${colors[index]}`
                  : `保存当前颜色到位置 ${index + 1}`
              }
              onClick={() =>
                colors[index] ? onPick(colors[index]) : onAdd(index)
              }
            />
          );
        },
      )}
    </fieldset>
  );
}

function ColorEditor({
  value,
  colors,
  onAdd,
  onPreview,
  onChange,
}: {
  value: string;
  colors: string[];
  onAdd: (color: string, index: number) => void;
  onPreview: (value: string) => void;
  onChange: (value: string) => void;
}) {
  const [hsv, setHsv] = useState(() => hsvOf(value));
  const [text, setText] = useState(value.slice(1).toUpperCase());
  const [channels, setChannels] = useState(() => rgbOf(value).map(String));
  const latest = useRef(hsv);
  const frame = useRef(0);
  const dragging = useRef(false);
  const hex = hsvHex(hsv);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (dragging.current || value === hsvHex(latest.current)) return;
    const next = hsvOf(value, latest.current.h);
    latest.current = next;
    setHsv(next);
    setText(value.slice(1).toUpperCase());
    setChannels(rgbOf(value).map(String));
  }, [value]);
  const show = (next: Hsv, commit: boolean) => {
    latest.current = next;
    const color = hsvHex(next);
    setHsv(next);
    setText(color.slice(1).toUpperCase());
    setChannels(rgbOf(color).map(String));
    onPreview(color);
    if (commit) onChange(color);
  };
  const pick = (color: string) => show(hsvOf(color, latest.current.h), true);
  const point = (event: PointerEvent<HTMLElement>, hue: boolean) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(1, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.max(
      0,
      Math.min(1, (event.clientY - rect.top) / rect.height),
    );
    latest.current = hue
      ? { ...latest.current, h: x * 360 }
      : { ...latest.current, s: x, v: 1 - y };
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => show(latest.current, false));
  };
  const handlers = (hue: boolean) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = true;
      point(event, hue);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        point(event, hue);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      point(event, hue);
      cancelAnimationFrame(frame.current);
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      show(latest.current, true);
    },
    onPointerCancel: () => {
      cancelAnimationFrame(frame.current);
      dragging.current = false;
      show(latest.current, true);
    },
  });
  return (
    <>
      <header className="color-card-heading">
        <h3>自定义颜色</h3>
        <Popover.Close
          render={
            <Button
              variant="ghost"
              size="icon-small"
              aria-label="关闭自定义颜色"
            />
          }
        >
          <CloseMark />
        </Popover.Close>
      </header>
      <CustomColors
        colors={colors}
        selected={hex}
        onPick={pick}
        onAdd={(index) => onAdd(hex, index)}
      />
      <div className="color-field-row">
        <div
          className="color-plane"
          role="slider"
          tabIndex={0}
          aria-label="饱和度与亮度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuetext={`饱和度 ${Math.round(hsv.s * 100)}%，亮度 ${Math.round(hsv.v * 100)}%`}
          style={
            { "--hue-color": hsvHex({ h: hsv.h, s: 1, v: 1 }) } as CSSProperties
          }
          {...handlers(false)}
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            const step = event.shiftKey ? 0.1 : 0.01;
            show(
              {
                ...hsv,
                s: Math.max(
                  0,
                  Math.min(
                    1,
                    hsv.s +
                      (event.key === "ArrowRight"
                        ? step
                        : event.key === "ArrowLeft"
                          ? -step
                          : 0),
                  ),
                ),
                v: Math.max(
                  0,
                  Math.min(
                    1,
                    hsv.v +
                      (event.key === "ArrowUp"
                        ? step
                        : event.key === "ArrowDown"
                          ? -step
                          : 0),
                  ),
                ),
              },
              true,
            );
          }}
        >
          <span
            className="color-handle"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              background: hex,
            }}
          />
        </div>
        <div className="color-channels">
          {["R", "G", "B"].map((label, index) => (
            <label className="color-number" key={label}>
              <span>{label}</span>
              <input
                aria-label={label}
                inputMode="numeric"
                value={channels[index]}
                maxLength={3}
                onChange={(event) => {
                  const next = [...channels];
                  next[index] = event.target.value;
                  setChannels(next);
                  if (
                    next.every(
                      (entry) =>
                        /^\d{1,3}$/.test(entry) && Number(entry) <= 255,
                    )
                  ) {
                    const color = hexOf(next.map(Number));
                    const nextHsv = hsvOf(color, latest.current.h);
                    latest.current = nextHsv;
                    setHsv(nextHsv);
                    setText(color.slice(1).toUpperCase());
                    onPreview(color);
                    onChange(color);
                  }
                }}
                onBlur={() => setChannels(rgbOf(hex).map(String))}
              />
            </label>
          ))}
        </div>
      </div>
      <div
        className="color-hue"
        role="slider"
        tabIndex={0}
        aria-label="色相"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        {...handlers(true)}
        onKeyDown={(event) => {
          const delta =
            event.key === "ArrowRight" || event.key === "ArrowUp"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? -1
                : 0;
          if (!delta && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          show(
            {
              ...hsv,
              h:
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 360
                    : Math.max(
                        0,
                        Math.min(
                          360,
                          hsv.h + delta * (event.shiftKey ? 10 : 1),
                        ),
                      ),
            },
            true,
          );
        }}
      >
        <span
          className="color-handle"
          style={{
            left: `${hsv.h / 3.6}%`,
            background: hsvHex({ h: hsv.h, s: 1, v: 1 }),
          }}
        />
      </div>
      <label className="color-hex">
        <span>#</span>
        <input
          aria-label="HEX"
          aria-invalid={!/^[0-9a-f]{6}$/i.test(text)}
          spellCheck={false}
          value={text}
          maxLength={7}
          onChange={(event) => {
            const next = event.target.value.replace(/^#/, "");
            setText(next);
            if (/^[0-9a-f]{6}$/i.test(next)) {
              const color = `#${next.toLowerCase()}`;
              const nextHsv = hsvOf(color, latest.current.h);
              latest.current = nextHsv;
              setHsv(nextHsv);
              setChannels(rgbOf(color).map(String));
              onPreview(color);
              onChange(color);
            }
          }}
          onBlur={() => setText(hex.slice(1).toUpperCase())}
        />
      </label>
    </>
  );
}

export function ColorPicker({
  value,
  colors,
  onColorsChange,
  onPreview,
  onChange,
}: {
  value: string;
  colors: string[];
  onColorsChange: (colors: string[]) => void;
  onPreview: (color: string) => void;
  onChange: (color: string) => void;
}) {
  const add = (color: string, index: number) => {
    const next = [...colors];
    next[index] = color;
    onColorsChange(next);
  };
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<button type="button" className="profile-color-trigger" />}
      >
        <span className="profile-color-chip" style={{ background: value }} />
        <span>主题色</span>
        <span className="profile-color-value">{value.toUpperCase()}</span>
        <span aria-hidden="true">⌄</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="left"
          align="end"
          sideOffset={16}
          collisionPadding={16}
          collisionAvoidance={{ side: "shift", align: "shift" }}
          className="color-positioner"
        >
          <Popover.Popup
            className="color-card color-palette"
            aria-label="主题色"
            initialFocus={false}
          >
            <header className="color-card-heading">
              <h3>主题色</h3>
              <Popover.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon-small"
                    aria-label="关闭主题色"
                  />
                }
              >
                <CloseMark />
              </Popover.Close>
            </header>
            <fieldset
              className="color-swatches color-preset-grid"
              aria-label="预设颜色"
            >
              {characterColors.map(({ color, name }) => (
                <Swatch
                  key={color}
                  color={color}
                  selected={value === color}
                  label={`颜色：${name}`}
                  onClick={() => {
                    onPreview(color);
                    onChange(color);
                  }}
                />
              ))}
            </fieldset>
            <div className="color-custom-heading">
              <h4>自定义颜色</h4>
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-small"
                      aria-label="编辑自定义颜色"
                    />
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="m15 5 4 4M5 15 15 5a3 3 0 0 1 4 4L9 19l-5 1z" />
                  </svg>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner
                    side="right"
                    align="end"
                    sideOffset={-12}
                    alignOffset={-48}
                    collisionPadding={16}
                    collisionAvoidance={{ side: "shift", align: "shift" }}
                    className="color-positioner color-editor-positioner"
                  >
                    <Popover.Popup
                      className="color-card color-editor"
                      aria-label="自定义颜色"
                      initialFocus={(type) =>
                        type === "keyboard"
                          ? document.querySelector<HTMLElement>(
                              '.color-editor [role="slider"]',
                            )
                          : false
                      }
                    >
                      <ColorEditor
                        value={value}
                        colors={colors}
                        onAdd={add}
                        onPreview={onPreview}
                        onChange={onChange}
                      />
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            </div>
            <CustomColors
              colors={colors}
              selected={value}
              onPick={(color) => {
                onPreview(color);
                onChange(color);
              }}
              onAdd={(index) => add(value, index)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

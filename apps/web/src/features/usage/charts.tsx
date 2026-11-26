import { EngineMark } from "@domos/ui/avatar";
import { area, curveMonotoneX, line } from "d3-shape";
import {
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type dailyUsage,
  dayLabel,
  engineColor,
  formatAxis,
  formatValue,
  harnesses,
  type Metric,
} from "./data.ts";

export function DailyChart({
  days,
  metric,
}: {
  days: ReturnType<typeof dailyUsage>;
  metric: Metric;
}) {
  const fillId = useId();
  const curves = useRef<SVGGElement>(null);
  const previous = useRef("");
  useLayoutEffect(() => {
    const group = curves.current;
    const key = JSON.stringify([
      metric,
      days.map((day) => [
        day.day,
        day.engines.map(({ key, value }) => [key, value]),
      ]),
    ]);
    if (!group || previous.current === key) return;
    previous.current = key;
    for (const animation of group.getAnimations()) animation.cancel();
    if (
      document.hidden ||
      group.closest("[hidden]") ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !days.some((day) =>
        day.engines.some((engine) => engine.value !== null && engine.value > 0),
      )
    )
      return;
    const style = getComputedStyle(group);
    group.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
      duration: Number.parseFloat(style.getPropertyValue("--motion-data")),
      easing: style.getPropertyValue("--ease-message-in").trim(),
    });
  }, [days, metric]);
  useLayoutEffect(() => {
    const group = curves.current;
    const settle = () => {
      for (const animation of group?.getAnimations() ?? []) animation.cancel();
    };
    const visibility = () => {
      if (document.hidden) settle();
    };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => {
      if (reduced.matches) settle();
    };
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", motion);
    return () => {
      settle();
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", motion);
    };
  }, []);
  const series = (days[0]?.engines ?? []).map((engine, index) => ({
    key: engine.key,
    values: days.map((day) => day.engines[index]?.value ?? null),
  }));
  const max = Math.max(
    ...series.flatMap((item) => item.values.map((value) => value ?? 0)),
    0,
  );
  const rawStep = (max * 1.15 || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((value) => value * magnitude)
      .find((value) => value >= rawStep) ?? magnitude * 10;
  const scale = Math.ceil((max * 1.15 || 1) / step) * step;
  const ticks = Array.from(
    { length: Math.round(scale / step) + 1 },
    (_, index) => index * step,
  );
  const x = (index: number) =>
    days.length < 2 ? 500 : (index / (days.length - 1)) * 1000;
  const y = (value: number) => 230 - (value / scale) * 220;
  const curve = line<number | null>()
    .defined((value) => value !== null)
    .x((_, index) => x(index))
    .y((value) => y(value ?? 0))
    .curve(curveMonotoneX);
  const fill = area<number | null>()
    .defined((value) => value !== null)
    .x((_, index) => x(index))
    .y0(230)
    .y1((value) => y(value ?? 0))
    .curve(curveMonotoneX);
  return (
    <div className="usage-chart">
      <div className="usage-chart-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick} style={{ top: `${(y(tick) / 240) * 100}%` }}>
            {formatAxis(tick, metric)}
          </span>
        ))}
      </div>
      <ChartInteraction days={days} metric={metric} scale={scale}>
        <svg
          viewBox="0 0 1000 240"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {ticks.map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="1000"
              y1={y(tick)}
              y2={y(tick)}
              className="usage-grid-line"
            />
          ))}
          <g className="usage-chart-series" ref={curves}>
            {series.map((item) => (
              <g
                key={item.key}
                data-engine={item.key}
                style={{ color: engineColor(item.key) }}
              >
                <defs>
                  <linearGradient
                    id={`${fillId}-${item.key}`}
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="currentColor"
                      stopOpacity="0.12"
                    />
                    <stop
                      offset="100%"
                      stopColor="currentColor"
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                <path
                  d={fill(item.values) ?? undefined}
                  fill={`url(#${fillId}-${item.key})`}
                />
                <path
                  d={curve(item.values) ?? undefined}
                  className="usage-line"
                />
                {item.values.map(
                  (value, index) =>
                    value !== null &&
                    item.values[index - 1] == null &&
                    item.values[index + 1] == null && (
                      <circle
                        key={days[index]?.day}
                        cx={x(index)}
                        cy={y(value)}
                        r="2.5"
                        fill="currentColor"
                      />
                    ),
                )}
              </g>
            ))}
          </g>
        </svg>
      </ChartInteraction>
      <div className="usage-chart-dates" aria-hidden="true">
        {[0, Math.round((days.length - 1) / 2), days.length - 1]
          .filter((index, slot, all) => all.indexOf(index) === slot)
          .map((index) => (
            <span key={index}>
              {days[index] ? dayLabel(days[index].day) : ""}
            </span>
          ))}
      </div>
    </div>
  );
}

function ChartInteraction({
  days,
  metric,
  scale,
  children,
}: {
  days: ReturnType<typeof dailyUsage>;
  metric: Metric;
  scale: number;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const pointerX = useRef(0);
  const rect = useRef<DOMRect | null>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [tipSize, setTipSize] = useState({ width: 0, height: 0 });
  const active = hovered === null ? undefined : days[hovered];
  const visible = Boolean(active);
  const cancelFrame = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useLayoutEffect(() => {
    const invalidate = () => {
      rect.current = null;
    };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      invalidate();
      const { width, height } = entry.contentRect;
      setBounds((old) =>
        old.width === width && old.height === height ? old : { width, height },
      );
    });
    if (plot.current) observer.observe(plot.current);
    window.addEventListener("scroll", invalidate, {
      capture: true,
      passive: true,
    });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", invalidate, true);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);
  useLayoutEffect(() => {
    if (!visible || !tip.current) return;
    const observer = new ResizeObserver(() => {
      if (!tip.current) return;
      const { width, height } = tip.current.getBoundingClientRect();
      setTipSize((old) =>
        old.width === width && old.height === height ? old : { width, height },
      );
    });
    observer.observe(tip.current);
    return () => observer.disconnect();
  }, [visible]);
  const select = (clientX: number) => {
    if (!plot.current) return;
    rect.current ??= plot.current.getBoundingClientRect();
    setHovered(
      Math.max(
        0,
        Math.min(
          days.length - 1,
          Math.round(
            ((clientX - rect.current.left) / rect.current.width) *
              (days.length - 1),
          ),
        ),
      ),
    );
  };
  const anchorX =
    (days.length < 2 ? 0.5 : (hovered ?? 0) / (days.length - 1)) * bounds.width;
  const selected =
    active?.engines.filter(
      (engine): engine is typeof engine & { value: number } =>
        engine.value !== null,
    ) ?? [];
  const anchorY =
    selected.length === 0
      ? bounds.height / 2
      : ((230 -
          (Math.max(...selected.map((engine) => engine.value)) / scale) * 220) /
          240) *
        bounds.height;
  const left = Math.max(
    0,
    Math.min(
      bounds.width - tipSize.width,
      anchorX + tipSize.width + 16 <= bounds.width
        ? anchorX + 16
        : anchorX - tipSize.width - 16,
    ),
  );
  const top = Math.max(
    0,
    Math.min(bounds.height - tipSize.height, anchorY - tipSize.height / 2),
  );
  return (
    <div
      className="usage-plot"
      ref={plot}
      onPointerLeave={() => {
        cancelFrame();
        setHovered(null);
      }}
    >
      {children}
      {active && hovered !== null && (
        <svg
          className="usage-chart-selection"
          viewBox="0 0 1000 240"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1={days.length < 2 ? 500 : (hovered / (days.length - 1)) * 1000}
            x2={days.length < 2 ? 500 : (hovered / (days.length - 1)) * 1000}
            y1="10"
            y2="230"
            className="usage-crosshair"
          />
          {selected.map((engine) => (
            <ellipse
              key={engine.key}
              cx={days.length < 2 ? 500 : (hovered / (days.length - 1)) * 1000}
              cy={230 - (engine.value / scale) * 220}
              rx={bounds.width ? 4000 / bounds.width : 4}
              ry={bounds.height ? 960 / bounds.height : 4}
              className="usage-active-point"
              style={{ color: engineColor(engine.key) }}
            />
          ))}
        </svg>
      )}
      <div
        className="usage-chart-hit"
        role="slider"
        tabIndex={0}
        aria-label={`每日${metric === "cost" ? "费用" : "用量"}趋势`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, days.length - 1)}
        aria-valuenow={hovered ?? 0}
        aria-valuetext={
          active
            ? `${active.day} ${formatValue(active.value, metric)}`
            : "使用方向键查看每日数据"
        }
        onPointerEnter={() => {
          rect.current = null;
        }}
        onPointerDown={(event) => {
          cancelFrame();
          event.currentTarget.focus({ preventScroll: true });
          select(event.clientX);
        }}
        onPointerMove={(event) => {
          pointerX.current = event.clientX;
          if (frame.current !== null) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            select(pointerX.current);
          });
        }}
        onFocus={() => setHovered((value) => value ?? 0)}
        onBlur={() => {
          cancelFrame();
          setHovered(null);
        }}
        onKeyDown={(event) => {
          if (
            !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          cancelFrame();
          if (event.key === "Escape") return setHovered(null);
          if (event.key === "Home") return setHovered(0);
          if (event.key === "End") return setHovered(days.length - 1);
          setHovered(
            Math.max(
              0,
              Math.min(
                days.length - 1,
                (hovered ?? 0) + (event.key === "ArrowRight" ? 1 : -1),
              ),
            ),
          );
        }}
      />
      {!days.some((day) =>
        day.engines.some((engine) => engine.value !== null),
      ) && <p className="usage-chart-empty">此范围暂无可用数据</p>}
      {active && (
        <div
          className="tooltip-surface usage-tip"
          role="tooltip"
          ref={tip}
          style={{
            transform: `translate3d(${left}px,${top}px,0)`,
            visibility: tipSize.width ? undefined : "hidden",
          }}
        >
          <strong>{active.day}</strong>
          {active.engines.map((engine) => (
            <div className="usage-tip-row" key={engine.key}>
              <span>
                <i
                  className="usage-series-dot"
                  style={{ background: engineColor(engine.key) }}
                  aria-hidden="true"
                />
                <EngineMark provider={engine.key} />
                {harnesses.find((item) => item.value === engine.key)?.label ??
                  engine.key}
              </span>
              <b>
                {engine.value === null
                  ? "未返回数据"
                  : formatValue(engine.value, metric)}
              </b>
            </div>
          ))}
          <div className="usage-tip-total">
            <span>{active.partial ? "已知合计" : "合计"}</span>
            <b>
              {active.value === null
                ? "未返回数据"
                : formatValue(active.value, metric)}
            </b>
          </div>
        </div>
      )}
    </div>
  );
}

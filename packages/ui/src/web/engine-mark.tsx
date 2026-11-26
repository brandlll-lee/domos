import antigravity from "./engine-assets/antigravity.svg";
import claude from "./engine-assets/claude-code.svg";
import codex from "./engine-assets/codex.svg";
import cursor from "./engine-assets/cursor.svg";
import devin from "./engine-assets/devin.svg";
import grok from "./engine-assets/grok.svg";
import "./engine-mark.css";
import { TerminalWindowIcon } from "@phosphor-icons/react/dist/csr/TerminalWindow";

const images: Record<string, { url: string; monochrome: boolean }> = {
  codex: {
    url: codex,
    monochrome: false,
  },
  claude: {
    url: claude,
    monochrome: false,
  },
  antigravity: {
    url: antigravity,
    monochrome: false,
  },
  grok: {
    url: grok,
    monochrome: true,
  },
  devin: {
    url: devin,
    monochrome: true,
  },
  cursor: {
    url: cursor,
    monochrome: true,
  },
};

const marks = {
  pi: {
    viewBox: "0 0 800 800",
    paths: [
      {
        d: "M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z M282.65 282.65 V400 H400 V282.65 Z",
        evenodd: true,
      },
      {
        d: "M517.36 400 H634.72 V634.72 H517.36 Z",
        evenodd: false,
      },
    ],
  },
  opencode: {
    viewBox: "0 0 24 24",
    paths: [
      {
        d: "M16 6H8v12h8V6zm4 16H4V2h16v20z",
        evenodd: true,
      },
    ],
  },
} satisfies Record<
  "pi" | "opencode",
  { viewBox: string; paths: { d: string; evenodd: boolean }[] }
>;

export function EngineMark({ provider }: { provider: string }) {
  const image = images[provider];
  if (image?.monochrome)
    return (
      <span
        className="engine-mark engine-mark-mask"
        data-provider={provider}
        style={{ maskImage: `url("${image.url}")` }}
        aria-hidden="true"
      />
    );
  if (image)
    return (
      <img
        className="engine-mark"
        data-provider={provider}
        src={image.url}
        alt=""
        draggable={false}
      />
    );
  const mark = marks[provider as keyof typeof marks];
  if (!mark)
    return (
      <TerminalWindowIcon
        className="engine-mark"
        data-provider={provider}
        aria-hidden="true"
      />
    );
  return (
    <svg
      className="engine-mark"
      data-provider={provider}
      viewBox={mark.viewBox}
      aria-hidden="true"
    >
      {mark.paths.map(({ d, evenodd }) => (
        <path key={d} d={d} fillRule={evenodd ? "evenodd" : undefined} />
      ))}
    </svg>
  );
}

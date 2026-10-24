const styles = `
  :host {
    --rim-hi: color-mix(in oklab, var(--bot-color) 52%, #fff);
    --rim-lo: color-mix(in oklab, var(--bot-color) 82%, #17191e);
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    contain: strict;
  }
  * { box-sizing: border-box; }
  .rim { position: absolute; }
  .cut {
    position: absolute;
    inset: -40px;
    mask-repeat: no-repeat;
    -webkit-mask-repeat: no-repeat;
  }
  .glow, .ring, .sheen {
    position: absolute;
    inset: 40px;
    border-radius: var(--radius-panel, 16px);
  }
  .glow {
    box-shadow:
      0 0 6px color-mix(in oklab, var(--bot-color) 44%, transparent),
      0 0 18px 2px color-mix(in oklab, var(--bot-color) 24%, transparent),
      0 0 34px 3px color-mix(in oklab, var(--bot-color) 12%, transparent);
  }
  .ring {
    padding: 1.5px;
    background: linear-gradient(138deg, var(--rim-hi), var(--bot-color) 38%, var(--rim-lo) 70%, var(--rim-hi));
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask-composite: exclude;
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
  }
  .sheen {
    background:
      radial-gradient(ellipse 90px 100px at 100% 100%, color-mix(in oklab, var(--bot-color) 20%, transparent), transparent),
      radial-gradient(ellipse 70px 90px at 0 0, color-mix(in oklab, var(--bot-color) 12%, transparent), transparent);
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, #fff 22%, transparent),
      inset 0 0 18px -5px color-mix(in oklab, var(--bot-color) 52%, transparent),
      inset 0 0 46px -14px color-mix(in oklab, var(--bot-color) 25%, transparent);
  }
  .cursor {
    position: absolute;
    left: 0;
    top: 0;
    width: 32px;
    height: 35.2px;
    filter: drop-shadow(0 1px 1.2px #0003) drop-shadow(0 0 0.4px #fff5);
    will-change: transform;
  }
  .cursor svg {
    width: 100%;
    height: 100%;
    overflow: visible;
    transform-origin: 5px 5px;
  }
  .pulse {
    fill: none;
    stroke: var(--rim-hi);
    stroke-width: 1.5;
    transform-origin: 5px 5px;
    opacity: 0;
  }
  .acting .pulse { animation: click 420ms cubic-bezier(0.2, 0.7, 0.2, 1); }
  .acting svg { animation: press 180ms cubic-bezier(0.3, 0.8, 0.3, 1); }
  @keyframes click {
    from { transform: scale(0.25); opacity: 0.9; }
    to { transform: scale(2.4); opacity: 0; }
  }
  @keyframes press {
    40% { transform: scale(0.94); }
  }
  @media (prefers-reduced-motion: reduce) {
    .acting .pulse, .acting svg { animation: none; }
  }
  @media (forced-colors: active) {
    .glow, .sheen { display: none; }
    .ring {
      padding: 0;
      border: 2px solid Highlight;
      background: none;
      mask: none;
      -webkit-mask: none;
    }
    .material { filter: url(#contrast); }
    .pulse { stroke: Highlight; }
  }
`;

const markup = `
  <div class="rim" hidden>
    <div class="cut">
      <div class="glow"></div>
      <div class="ring"></div>
      <div class="sheen"></div>
    </div>
  </div>
  <div class="cursor" hidden>
    <svg viewBox="0 0 40 44" aria-hidden="true">
      <defs>
        <filter id="material" color-interpolation-filters="sRGB">
          <feColorMatrix in="SourceGraphic" values="0 .58 -.58 0 .42  0 .58 -.58 0 .42  0 .58 -.58 0 .42  0 0 0 0 1" result="shade" />
          <feFlood flood-color="var(--bot-color)" result="tint" />
          <feBlend in="tint" in2="shade" mode="multiply" result="body" />
          <feColorMatrix in="SourceGraphic" values="0 0 1 0 0  0 0 1 0 0  0 0 1 0 0  0 0 0 0 1" result="shine" />
          <feComposite in="body" in2="shine" operator="arithmetic" k2="1" k3="1" result="lit" />
          <feComposite in="lit" in2="SourceGraphic" operator="in" />
        </filter>
        <filter id="contrast"><feFlood flood-color="Highlight" /><feComposite in2="SourceGraphic" operator="in" /></filter>
      </defs>
      <image class="material" x="1" y="1" width="33" height="42" href="data:image/webp;base64,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" filter="url(#material)" />
      <circle class="pulse" cx="5" cy="5" r="5" />
    </svg>
  </div>
`;

export const effectArt = { styles, markup };

export type CharacterWork = { id?: string; working: boolean };

export function WorkHeadset() {
  return (
    <g className="character-work-headset">
      <path
        className="character-headband"
        d="M16 48C12 3 88 3 84 48"
        stroke="#1a1a1c"
        strokeWidth="6"
      />
      <path
        className="character-headband"
        d="M16 45C15 5 85 5 84 45"
        stroke="#59595b"
        strokeWidth="1"
      />
      <path
        className="character-headband"
        d="M20 32C31 10 69 10 80 32"
        stroke="#29292b"
        strokeWidth="2.5"
      />
      {[false, true].map((right) => (
        <g
          key={String(right)}
          transform={right ? "translate(100 0) scale(-1 1)" : undefined}
        >
          <g className="character-earcup" transform="rotate(-15 17 48)">
            <rect
              x="10"
              y="35"
              width="12"
              height="26"
              rx="5.7"
              fill="#121214"
            />
            <rect
              x="10.7"
              y="35.7"
              width="9.3"
              height="24.6"
              rx="4.6"
              fill="#2c2c2f"
              stroke="#49494c"
              strokeWidth=".65"
            />
            <path
              d="M13 40v15"
              stroke="#57575a"
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity=".6"
            />
            <path
              d="M20.7 39v18"
              stroke="#08080a"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </g>
        </g>
      ))}
    </g>
  );
}

export function WorkComputer({ id }: { id: string }) {
  return (
    <g className="character-work-computer">
      <defs>
        <linearGradient id={`${id}-lid`} x2=".15" y2="1">
          <stop stopColor="#89888c" />
          <stop offset=".45" stopColor="#66656a" />
          <stop offset="1" stopColor="#515055" />
        </linearGradient>
      </defs>
      <g className="character-computer-motion">
        <rect
          x="24"
          y="68"
          width="52"
          height="25"
          rx="3.5"
          fill={`url(#${id}-lid)`}
          stroke="#b0aeb3"
          strokeWidth=".6"
        />
        <path
          d="M27 69.4H73"
          stroke="#d3d0d6"
          strokeOpacity=".5"
          strokeWidth=".5"
        />
        <rect
          x="46.6"
          y="78.6"
          width="6.8"
          height="4.5"
          rx="2.2"
          fill="#cbc8cf"
          opacity=".58"
        />
        <path
          d="M21 93H79L76 95H24Z"
          fill="#88868e"
          stroke="#a7a4ad"
          strokeWidth=".4"
        />
        <path
          d="M43 93.3H57"
          stroke="#46444b"
          strokeWidth=".9"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

export function WorkBurst({ color }: { color: string }) {
  return (
    <g className="character-work-burst">
      <g
        className="character-work-cloud"
        fill="#f1eee5"
        stroke="#d6d0bf"
        strokeWidth=".45"
      >
        <path d="M17 61C4 62 2 48 12 42C3 30 14 20 25 24C25 9 41 6 48 18C58 4 75 10 75 23C91 16 103 31 92 42C106 50 99 66 87 65C91 80 74 88 65 77C55 91 38 85 37 76C22 85 9 74 17 61Z" />
        <path
          d="M21 35q-7 0-7 7M75 29q10-3 12 6M57 75q-8 7-14 0"
          fill="none"
          stroke="#fffdf8"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </g>
      <g
        className="character-work-rays"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth="2.2"
      >
        <path d="M7 15l5 6M48 0v8M90 13l-5 7M106 47l-8 1M4 76l7-4M91 86l-6-6" />
      </g>
    </g>
  );
}

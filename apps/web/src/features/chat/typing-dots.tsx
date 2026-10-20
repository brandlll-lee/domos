export function TypingDots({ label }: { label: string }) {
  return (
    <div className="typing-dots" role="status" aria-label={label}>
      <svg viewBox="0 0 68 40" aria-hidden="true">
        {[22, 34, 46].map((x) => (
          <g key={x}>
            <circle cx={x} cy="20" r="3.5" />
          </g>
        ))}
      </svg>
    </div>
  );
}

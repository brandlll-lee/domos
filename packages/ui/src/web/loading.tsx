export function LoadingDots({ label }: { label: string }) {
  return (
    <span className="loading-dots" role="status" aria-label={label}>
      <svg viewBox="0 0 32 16" aria-hidden="true">
        {[8, 16, 24].map((x) => (
          <g key={x}>
            <circle cx={x} cy="10" r="2" />
          </g>
        ))}
      </svg>
    </span>
  );
}

export function Loading({
  label,
  inline = false,
}: {
  label: string;
  inline?: boolean;
}) {
  return (
    <span
      className="loading"
      data-inline={inline || undefined}
      role="status"
      aria-label={label}
    >
      <span className="loading-spinner" aria-hidden="true" />
    </span>
  );
}

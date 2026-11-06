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

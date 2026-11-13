export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="unread-badge" aria-label={`${count} 条未读`} role="status">
      {count > 99 ? "99+" : count}
    </span>
  );
}

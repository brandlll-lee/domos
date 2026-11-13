import { Button } from "./controls.tsx";
import "./pagination.css";

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  disabled,
  label,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <nav className="pagination" aria-label={label}>
      <span aria-live="polite">
        {total ? (page - 1) * pageSize + 1 : 0}–
        {Math.min(page * pageSize, total)} / {total}
      </span>
      <div>
        <Button
          size="small"
          variant="secondary"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          上一页
        </Button>
        <Button
          size="small"
          variant="secondary"
          disabled={disabled || page * pageSize >= total}
          onClick={() => onPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </nav>
  );
}

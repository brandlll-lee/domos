import { SegmentedControl } from "@domos/ui/choice";
import { Button } from "@domos/ui/controls";
import { Dialog } from "@domos/ui/dialog";
import { TextField } from "@domos/ui/field";
import { Loading } from "@domos/ui/loading";
import { InlineNotice } from "@domos/ui/message";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { DesktopIcon } from "@phosphor-icons/react/dist/csr/Desktop";
import { FolderIcon } from "@phosphor-icons/react/dist/csr/Folder";
import { useRef, useState } from "react";
import "./directory.css";

export type DirectoryListing = {
  path: string;
  parent: string;
  items: { name: string; path: string }[];
};

export function DirectoryPicker({
  botName,
  computerName,
  personalDirectory,
  currentDirectory,
  listing,
  loading,
  saving,
  error,
  onBrowse,
  onChoose,
  onClose,
}: {
  botName: string;
  computerName: string;
  personalDirectory?: string;
  currentDirectory: string | null;
  listing: DirectoryListing;
  loading: boolean;
  saving: boolean;
  error: string;
  onBrowse: (path: string) => void;
  onChoose: (path: string | null) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState(currentDirectory ? "project" : "personal");
  const [typing, setTyping] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const confirm = useRef<HTMLButtonElement>(null);
  const [path, setPath] = useState(listing.path);
  const selection = mode === "personal" ? personalDirectory : listing.path;
  const name = selection?.split(/[\\/]/).filter(Boolean).at(-1) ?? selection;
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !saving && onClose()}
      title="工作文件夹"
      layout="task"
      className="management-dialog directory-dialog"
      initialFocus={() => confirm.current}
      footer={
        <div className="management-footer">
          <span className="directory-note">
            文件保留在原处，下次工作使用新的模型会话。
          </span>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button
            ref={confirm}
            pending={saving}
            disabled={loading}
            onClick={() => onChoose(mode === "personal" ? null : listing.path)}
          >
            使用此文件夹
          </Button>
        </div>
      }
    >
      <div className="directory-body">
        <div className="directory-heading">
          <span className="directory-computer">
            <DesktopIcon />
            {computerName}
          </span>
          <SegmentedControl
            label="文件夹类型"
            value={mode}
            onValueChange={setMode}
            disabled={saving}
            options={[
              {
                value: "personal",
                label: "个人文件夹",
              },
              {
                value: "project",
                label: "指定文件夹",
              },
            ]}
          />
        </div>
        <div className="directory-destination">
          <FolderIcon />
          <span>
            <strong>
              {mode === "personal" ? `${botName} 的个人文件夹` : name}
            </strong>
            <small title={selection}>
              {selection ?? "使用当前 Bot 在这台电脑上的个人文件夹"}
            </small>
          </span>
          <Button
            variant="ghost"
            size="icon-small"
            aria-label="复制完整路径"
            title="复制完整路径"
            disabled={!selection}
            onClick={async () => {
              try {
                if (selection) await navigator.clipboard.writeText(selection);
                setCopyNotice("路径已复制");
              } catch {
                setCopyNotice("复制失败，请重试。");
              }
            }}
          >
            <CopyIcon />
          </Button>
        </div>
        {mode === "project" && (
          <section
            className="directory-browser"
            aria-label="浏览文件夹"
            aria-busy={loading}
          >
            <div className="directory-toolbar">
              <Button
                variant="ghost"
                size="icon-small"
                title="上一级目录"
                aria-label="上一级目录"
                disabled={loading || saving || listing.path === listing.parent}
                onClick={() => onBrowse(listing.parent)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={saving}
                onClick={() => {
                  setPath(listing.path);
                  setTyping(!typing);
                }}
              >
                输入路径
              </Button>
            </div>
            {typing && (
              <form
                className="directory-path"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (path.trim()) onBrowse(path.trim());
                }}
              >
                <TextField
                  label="文件夹完整路径"
                  value={path}
                  onValueChange={setPath}
                  autoFocus
                  disabled={saving}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={!path.trim() || loading || saving}
                >
                  前往
                </Button>
              </form>
            )}
            <div className="directory-list">
              {loading && <Loading label="正在读取文件夹" />}
              {listing.items.map((item) => (
                <button
                  type="button"
                  className="directory-row"
                  key={item.path}
                  disabled={loading || saving}
                  onClick={() => onBrowse(item.path)}
                >
                  <FolderIcon />
                  <span>{item.name}</span>
                  <span className="directory-row-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
              {!loading && !listing.items.length && (
                <p className="management-empty">
                  这里没有子文件夹。可以直接使用当前文件夹。
                </p>
              )}
            </div>
          </section>
        )}
        {error && <InlineNotice>{error}</InlineNotice>}
        {copyNotice && (
          <p className="management-muted" role="status">
            {copyNotice}
          </p>
        )}
      </div>
    </Dialog>
  );
}

import { type ReactNode, useEffect, useRef } from "react";
import { BrandMark } from "./avatar.tsx";
import { CharacterTeam } from "./character-team.tsx";
import { ScrollArea } from "./scroll-area.tsx";
import "./scroll-area.css";

export { CharacterTeam };

export function SetupPage({
  title,
  description,
  footer,
  corner,
  children,
}: {
  title: string;
  description?: string;
  footer?: ReactNode;
  corner?: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (title) heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <main className="setup-page" aria-label={title}>
      <ScrollArea className="setup-scroll">
        <div className="setup-content">
          <header className="setup-heading">
            <h1 ref={heading} tabIndex={-1}>
              {title}
            </h1>
            {description && <p>{description}</p>}
          </header>
          <div className="setup-body">{children}</div>
          {footer && <footer className="setup-actions">{footer}</footer>}
        </div>
      </ScrollArea>
      {corner && <div className="setup-corner">{corner}</div>}
    </main>
  );
}

export function SetupStatus({ children }: { children: ReactNode }) {
  return (
    <div className="setup-status" role="status">
      <CharacterTeam />
      <span>{children}</span>
    </div>
  );
}

export function SetupComputer() {
  return (
    <div className="setup-computer" aria-hidden="true">
      <div className="setup-computer-window">
        <span />
        <span />
        <span />
        <div className="setup-computer-lines">
          <i />
          <i />
          <i />
        </div>
      </div>
      <BrandMark />
    </div>
  );
}

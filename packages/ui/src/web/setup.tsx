import { type ReactNode, useEffect, useRef } from "react";
import { BrandMark } from "./avatar.tsx";
import { CharacterTeam } from "./character-team.tsx";

export { CharacterTeam };

export function SetupPage({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (title) heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <main className="setup-page" aria-label={title}>
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

import { BrandMark } from "@domos/ui/avatar";
import { brandCharacter } from "@domos/ui/characters";
import { Character } from "../character.tsx";
import { EngineMark } from "../engine-mark.tsx";
import { ComputerIllustration } from "./computer-illustration.tsx";
import "./remote-connection.css";

export function RemoteConnection({ provider }: { provider?: string }) {
  return (
    <div className="remote-connection" aria-hidden="true">
      <span className="remote-bot">
        <Character {...brandCharacter} state="idle" />
      </span>
      <svg className="remote-link" viewBox="0 0 120 44" aria-hidden="true">
        <path className="remote-dashes" d="M6 14H114 M114 30H6" />
        <path className="remote-arrows" d="m108 9 6 5-6 5 M12 25l-6 5 6 5" />
        <circle className="remote-packet" cx="6" cy="14" r="3" />
        <circle
          className="remote-packet remote-packet-return"
          cx="114"
          cy="30"
          r="3"
        />
      </svg>
      {provider ? (
        <span className="remote-harness">
          <EngineMark provider={provider} />
        </span>
      ) : (
        <ComputerIllustration className="remote-computer">
          <BrandMark />
        </ComputerIllustration>
      )}
    </div>
  );
}

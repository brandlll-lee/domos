import { WorkBurst } from "@domos/ui/character-work";
import { brandCharacter } from "@domos/ui/characters";
import { Character } from "../character.tsx";
import { ComputerIllustration } from "./computer-illustration.tsx";
import "./ready-companion.css";

export function ReadyCompanion() {
  return (
    <div className="ready-companion" aria-hidden="true">
      <ComputerIllustration className="ready-computer">
        <span />
      </ComputerIllustration>
      <div className="ready-foreground">
        <span className="ready-arrival">
          <Character {...brandCharacter} state="idle" />
        </span>
        <svg
          className="character ready-burst"
          viewBox="0 0 100 100"
          data-entering="true"
          aria-hidden="true"
        >
          <WorkBurst color={brandCharacter.color} />
        </svg>
      </div>
    </div>
  );
}

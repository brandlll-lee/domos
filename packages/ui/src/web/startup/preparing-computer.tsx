import { brandCharacter } from "@domos/ui/characters";
import { Loading } from "@domos/ui/loading";
import { Character } from "../character.tsx";
import { ComputerIllustration } from "./computer-illustration.tsx";
import "./preparing-computer.css";

export function PreparingComputer() {
  return (
    <div aria-hidden="true">
      <ComputerIllustration className="preparing-computer">
        <div className="preparing-viewport">
          <div className="preparing-camera">
            <Character {...brandCharacter} state="idle" />
          </div>
        </div>
        <div className="preparing-loading">
          <Loading label="正在准备电脑" inline />
        </div>
      </ComputerIllustration>
    </div>
  );
}

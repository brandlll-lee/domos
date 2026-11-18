import {
  Component,
  type CSSProperties,
  createRef,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { brandCharacter, type CharacterShape } from "../characters.ts";
import { Character } from "./character.tsx";
import { animateCharacter } from "./character-motion.ts";
import { Button } from "./controls.tsx";
import { type StartupStop, startupCamera } from "./startup-camera.ts";
import { startupTapes } from "./startup-tapes.ts";
import "./startup.css";

export function StartupLoading({
  message,
  status = "loading",
  children,
}: {
  message: string;
  status?: "loading" | "error" | "waiting";
  children?: ReactNode;
}) {
  const work = useId();
  return (
    <main className="startup-loading" aria-label="Domos 启动">
      <div className="startup-crt">
        <div className="startup-glass">
          <div className="startup-pixel-bot">
            <Character
              {...brandCharacter}
              state="running"
              work={{ id: work, working: true }}
            />
          </div>
          <div
            role={status === "error" ? "alert" : "status"}
            className="startup-readiness"
          >
            {status === "loading" && (
              <span className="startup-spinner" aria-hidden="true">
                {[
                  [50, 8],
                  [80, 20],
                  [92, 50],
                  [80, 80],
                  [50, 92],
                  [20, 80],
                  [8, 50],
                  [20, 20],
                ].map(([x, y], step) => (
                  <i
                    key={`${x}:${y}`}
                    style={
                      {
                        "--x": `${x}%`,
                        "--y": `${y}%`,
                        "--step": step,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
            )}
            <span>{message}</span>
          </div>
        </div>
      </div>
      {children && <div className="startup-loading-actions">{children}</div>}
    </main>
  );
}

const appearances = [
  brandCharacter,
  { shape: "bunny", color: "#f69dd1" },
  { shape: "sprout", color: "#91df74" },
  { shape: "cloud", color: "#7bc6ff" },
  { shape: "star", color: "#f8bd3e" },
  { shape: "chat", color: "#a79aff" },
] satisfies { shape: CharacterShape; color: string }[];
const sceneAppearance = {
  home: 0,
  engine: 2,
  model: 0,
  access: 4,
  address: 3,
  pair: 5,
} satisfies Record<StartupStop, number>;

function GuideBot({ stop }: { stop: StartupStop }) {
  const id = useId();
  const [appearance, setAppearance] = useState(sceneAppearance[stop]);
  const button = useRef<HTMLButtonElement>(null);
  const character = appearances[appearance] ?? brandCharacter;
  useEffect(() => {
    if (button.current)
      return animateCharacter(button.current, character.shape);
  }, [character.shape]);
  return (
    <Button
      ref={button}
      variant="ghost"
      className="startup-guide-bot"
      aria-label="随机变身"
      onClick={() =>
        setAppearance(
          (previous) =>
            (previous +
              1 +
              Math.floor(Math.random() * (appearances.length - 1))) %
            appearances.length,
        )
      }
    >
      <span className="character-gesture">
        <Character
          {...character}
          state="running"
          work={{ id: `${id}:${appearance}`, working: true }}
        />
      </span>
    </Button>
  );
}

type SceneProps = {
  stop: StartupStop;
  title: string;
  description?: string;
  children: ReactNode;
  back?: () => void;
  footer?: ReactNode;
};

function Screen({ stop, title, description }: SceneProps) {
  const [phase, setPhase] = useState(0);
  const frames = startupTapes[stop];
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase(frames.length - 1);
      return;
    }
    const timer = setInterval(
      () => setPhase((value) => (value + 1) % frames.length),
      710,
    );
    return () => clearInterval(timer);
  }, [frames]);
  const label = useId();
  return (
    <div className="startup-computer startup-crt">
      <div className="startup-glass startup-screen-copy">
        <pre className="startup-signal" aria-hidden="true">
          {frames[phase]}
        </pre>
        <h1 id={label} tabIndex={-1}>
          {title}
        </h1>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

export class StartupScene extends Component<SceneProps> {
  private viewport = createRef<HTMLDivElement>();
  private world = createRef<HTMLDivElement>();
  private wires = createRef<HTMLCanvasElement>();
  private scene = createRef<HTMLElement>();
  private camera?: ReturnType<typeof startupCamera>;
  private choice?: number;
  private returnAlongWire = () => {
    if (!this.viewport.current?.hasAttribute("data-travelling"))
      this.props.back?.();
  };

  private click = (event: MouseEvent) => {
    const scene = this.scene.current;
    const choice =
      event.target instanceof Element &&
      event.target.closest<HTMLElement>(".startup-branch");
    if (scene && choice && scene.contains(choice)) {
      this.choice =
        this.props.stop === "model"
          ? Number(choice.dataset.modelStep) + 1
          : Array.from(scene.querySelectorAll(".startup-branch")).indexOf(
              choice,
            );
    }
    if (this.props.back && this.camera?.hit(event)) this.returnAlongWire();
  };

  componentDidMount() {
    const { viewport, world, wires } = this;
    if (viewport.current && world.current && wires.current)
      this.camera = startupCamera(
        viewport.current,
        world.current,
        wires.current,
      );
    viewport.current?.addEventListener("click", this.click, true);
    this.show();
  }

  getSnapshotBeforeUpdate(previous: SceneProps) {
    const current = this.scene.current;
    if (!current || previous.stop === this.props.stop) return null;
    const copy = current.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-active");
    for (const input of copy.querySelectorAll("input,textarea")) {
      input.replaceWith(document.createElement("span"));
    }
    for (const canvas of current.querySelectorAll("canvas")) {
      const index = Array.from(current.querySelectorAll("canvas")).indexOf(
        canvas,
      );
      copy
        .querySelectorAll("canvas")
        [index]?.getContext("2d")
        ?.drawImage(canvas, 0, 0);
    }
    if (this.choice !== undefined)
      copy
        .querySelectorAll(".startup-branch")
        [this.choice]?.setAttribute("data-powered", "");
    return copy;
  }

  componentDidUpdate(
    previous: SceneProps,
    _state: unknown,
    snapshot: HTMLElement | null,
  ) {
    if (previous.stop !== this.props.stop) this.show(snapshot ?? undefined);
  }

  componentWillUnmount() {
    this.viewport.current?.removeEventListener("click", this.click, true);
    this.camera?.dispose();
  }

  private show(prior?: HTMLElement) {
    if (this.scene.current)
      this.camera?.show(
        this.props.stop,
        this.scene.current,
        prior,
        this.choice,
      );
    this.choice = undefined;
  }

  render() {
    const { stop, title, children, back, footer } = this.props;
    return (
      <main
        className="startup-guide"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === "Escape") this.returnAlongWire();
        }}
      >
        <header className="startup-rail">
          <span>Domos</span>
        </header>
        <div
          className="startup-viewport"
          ref={this.viewport}
          onPointerMove={(event) =>
            this.camera?.returnHover(
              Boolean(
                back &&
                  event.pointerType !== "touch" &&
                  this.camera.hit(event.nativeEvent),
              ),
            )
          }
          onPointerLeave={() => this.camera?.returnHover(false)}
        >
          <canvas className="startup-wires" ref={this.wires} inert />
          <div className="startup-world" ref={this.world}>
            <section
              key={stop}
              className="startup-scene"
              data-stop={stop}
              aria-label={title}
              ref={this.scene}
              onPointerOver={(event) => {
                if (event.pointerType === "touch") return;
                if (event.target instanceof Element)
                  this.camera?.preview(event.target.closest(".startup-branch"));
              }}
              onPointerOut={(event) => {
                if (!(event.target instanceof Element)) return;
                const node = event.target.closest(".startup-branch");
                if (
                  node &&
                  !(
                    event.relatedTarget instanceof Node &&
                    node.contains(event.relatedTarget)
                  )
                )
                  this.camera?.preview(null);
              }}
              onFocus={(event) => {
                if (event.target.matches(".startup-branch:focus-visible"))
                  this.camera?.preview(event.target);
              }}
              onBlur={() => this.camera?.preview(null)}
            >
              <Screen {...this.props} />
              <GuideBot stop={stop} />
              <div className="startup-station">{children}</div>
            </section>
          </div>
        </div>
        <footer className="startup-footer startup-rail">
          {back && (
            <Button
              variant="ghost"
              aria-label="返回"
              onClick={this.returnAlongWire}
              onPointerEnter={() => this.camera?.returnHover(true)}
              onPointerLeave={() => this.camera?.returnHover(false)}
            >
              <span aria-hidden="true">←</span> 沿线返回
            </Button>
          )}
          {footer}
        </footer>
      </main>
    );
  }
}

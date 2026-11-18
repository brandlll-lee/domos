import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "./controls.tsx";

function mediaTime(value: number) {
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

export function AudioAttachment({
  name,
  src,
  duration,
  waveform,
  action,
}: {
  name: string;
  src: string;
  duration?: number;
  waveform?: number[];
  action?: ReactNode;
}) {
  const id = useId();
  const player = useRef<HTMLAudioElement>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(duration ?? 0);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!started && duration !== undefined) setLength(duration);
  }, [duration, started]);
  useEffect(() => {
    const media = player.current;
    return () => {
      media?.pause();
      media?.removeAttribute("src");
      media?.load();
    };
  }, []);
  async function toggle() {
    const media = player.current;
    if (!media) return;
    if (!media.paused) {
      media.pause();
      return;
    }
    setError(false);
    try {
      if (!started || media.error) {
        media.src = src;
        setStarted(true);
      }
      await media.play();
    } catch {
      setError(true);
    }
  }
  return (
    <fieldset
      className="media-attachment media-attachment-audio"
      aria-label={`音频 ${name}`}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: Uploaded audio does not include a subtitle track. */}
      <audio
        ref={player}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setPosition(player.current?.currentTime ?? 0)}
        onLoadedMetadata={() => {
          const value = player.current?.duration;
          if (value !== undefined && Number.isFinite(value)) setLength(value);
        }}
        onError={() => {
          setError(true);
          setPlaying(false);
        }}
      />
      <Button
        variant="ghost"
        size="icon"
        className="audio-play"
        type="button"
        aria-label={`${playing ? "暂停" : "播放"} ${name}`}
        onClick={() => void toggle()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={playing ? "M6 5h4v14H6zM14 5h4v14h-4z" : "m8 5 11 7-11 7Z"}
            fill="currentColor"
          />
        </svg>
      </Button>
      <div className="audio-waveform">
        <svg viewBox="0 0 240 32" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id={`${id}-progress`}>
              <rect
                width={length ? (position / length) * 240 : 0}
                height="32"
              />
            </clipPath>
          </defs>
          <g id={`${id}-bars`}>
            {waveform ? (
              waveform.map((peak, index) => {
                const x = ((index + 0.5) * 240) / waveform.length;
                const halfHeight = 1 + peak * 13;
                return (
                  <line
                    key={x}
                    x1={x}
                    x2={x}
                    y1={16 - halfHeight}
                    y2={16 + halfHeight}
                  />
                );
              })
            ) : (
              <line x1="1" x2="239" y1="16" y2="16" />
            )}
          </g>
          <use
            href={`#${id}-bars`}
            clipPath={`url(#${id}-progress)`}
            className="audio-waveform-played"
          />
        </svg>
        <input
          type="range"
          min="0"
          max={length || 1}
          step="any"
          value={position}
          disabled={!started || !length}
          aria-label={`播放进度 ${name}`}
          aria-valuetext={`${mediaTime(position)} / ${mediaTime(length)}`}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (player.current) player.current.currentTime = value;
            setPosition(value);
          }}
        />
      </div>
      <span
        className="media-attachment-duration"
        title={length ? `总时长 ${mediaTime(length)}` : undefined}
      >
        {mediaTime(position)}
      </span>
      {action}
      {error && (
        <p role="alert" className="audio-error">
          音频无法播放。请重试、另存为或使用系统打开。
        </p>
      )}
    </fieldset>
  );
}

export function VideoAttachment({
  name,
  thumbnail,
  duration,
  onOpen,
  action,
}: {
  name: string;
  thumbnail?: string;
  duration?: number;
  onOpen: () => void;
  action: ReactNode;
}) {
  const time =
    duration !== undefined && Number.isFinite(duration)
      ? mediaTime(duration)
      : undefined;
  return (
    <div className="media-attachment media-attachment-video">
      <button
        type="button"
        className="media-attachment-preview"
        onClick={onOpen}
        aria-label={`预览 ${name}`}
      >
        {thumbnail && <img src={thumbnail} alt={`${name} 视频封面`} />}
        <span className="media-attachment-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9 5 11 7-11 7Z" fill="currentColor" />
          </svg>
        </span>
        {!thumbnail && (
          <span className="media-attachment-name" title={name}>
            {name}
          </span>
        )}
        {time && <span className="media-attachment-duration">{time}</span>}
      </button>
      <div className="media-attachment-menu">{action}</div>
    </div>
  );
}

export function FileAttachment({
  name,
  size,
  action,
  preview,
  icon,
  type,
  onOpen,
  footer,
  thumbnail,
  details,
}: {
  name: string;
  size: number;
  action: ReactNode;
  preview?: string;
  icon?: ReactNode;
  type?: string;
  onOpen?: () => void;
  footer?: ReactNode;
  thumbnail?: string;
  details?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (preview && !failed)
    return (
      <div className="attachment attachment-image">
        <a
          className="attachment-preview"
          href={preview}
          target="_blank"
          rel="noreferrer"
        >
          <img src={preview} alt={name} onError={() => setFailed(true)} />
        </a>
        {action}
      </div>
    );
  const units =
    size < 1024
      ? `${size} B`
      : size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const Caption = onOpen ? "button" : "div";
  return (
    <div className={footer ? "attachment file-card" : "attachment"}>
      {thumbnail && (
        <button
          type="button"
          className="file-card-thumbnail"
          onClick={onOpen}
          aria-label={`查看 ${name} 的预览`}
        >
          <img src={thumbnail} alt="文件首页预览" />
        </button>
      )}
      <div className="file-attachment">
        {icon ? (
          <span className="file-type-icon" data-type={type} aria-hidden="true">
            {icon}
          </span>
        ) : (
          <svg className="file-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" />
            <path d="M14 3v5h5M8 13h8M8 17h5" />
          </svg>
        )}
        <Caption
          className="file-caption"
          type={onOpen ? "button" : undefined}
          onClick={onOpen}
          aria-label={onOpen ? `预览 ${name}` : undefined}
        >
          <strong title={name}>{name}</strong>
          <span>
            {type && `${type} · `}
            {units}
            {details && ` · ${details}`}
          </span>
        </Caption>
        {action}
      </div>
      {footer && <div className="file-card-actions">{footer}</div>}
    </div>
  );
}

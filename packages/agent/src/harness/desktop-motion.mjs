import {
  CursorMotionStyle,
  CursorMotionTiming,
  defaultCursorMotionParams,
  planCursorMove,
} from "@trycua/cua-driver";

export function openDesktopMotion() {
  let previous;
  let trajectory;
  let started;
  let samples;
  return {
    move(point) {
      if (point.id !== previous?.id) {
        const from = trajectory
          ? trajectory.sampleAt((Date.now() - started) / 1000)
          : previous;
        trajectory?.uniffiDestroy();
        trajectory = undefined;
        samples = undefined;
        if (from) {
          trajectory = planCursorMove(
            {
              ...defaultCursorMotionParams(),
              style: CursorMotionStyle.Adaptive,
              timing: CursorMotionTiming.Native,
            },
            {
              fromPoint: { x: from.x, y: from.y },
              toPoint: { x: point.x, y: point.y },
              seed: String(point.id),
              reducedMotion: false,
            },
          );
          samples = trajectory.samples().map(({ t, x, y }) => ({ t, x, y }));
          started = Date.now();
        }
      }
      previous = point;
      return { ...point, ...(samples ? { motion: samples } : {}) };
    },
    clear() {
      trajectory?.uniffiDestroy();
      trajectory = previous = samples = undefined;
    },
  };
}

import { afterEach, expect, test, vi } from "vitest";
import {
  avatarImageStatus,
  prepareAvatarImages,
  retryAvatarImages,
} from "../src/web/avatar-images.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("avatar preparation shares reads, bounds waits and retries failed images", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  const reads: {
    src: string;
    decode: ReturnType<typeof Promise.withResolvers<void>>;
  }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      pending = Promise.withResolvers<void>();
      constructor() {
        reads.push({
          get src() {
            return image.src;
          },
          decode: this.pending,
        });
        const image = this;
      }
      decode() {
        return this.pending.promise;
      }
    },
  );
  const first = prepareAvatarImages(["/audit/ready", "/audit/slow"]);
  const shared = prepareAvatarImages(["/audit/ready"]);
  expect(reads).toHaveLength(2);
  reads[0]?.decode.resolve();
  await shared;
  expect(avatarImageStatus("/audit/ready")).toBe("ready");
  await vi.advanceTimersByTimeAsync(15_000);
  await first;
  expect(avatarImageStatus("/audit/slow")).toBe("failed");
  expect(reads[1]?.src).toBe("");
  const retried = retryAvatarImages(["/audit/ready", "/audit/slow"]);
  expect(reads).toHaveLength(3);
  reads[2]?.decode.resolve();
  await retried;
  reads[1]?.decode.resolve();
  await Promise.resolve();
  expect(avatarImageStatus("/audit/slow")).toBe("ready");
  expect(vi.getTimerCount()).toBe(0);
});

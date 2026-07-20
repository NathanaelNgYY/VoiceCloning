import { useEffect, useState } from "react";

const thumbnailCache = new Map();

function buildCacheKey(videoUrl, time, width, height) {
  return `${videoUrl}::${time}::${width}x${height}`;
}

function buildTopicKey(topic) {
  return `${topic.time}:${topic.thumbnailTime ?? topic.time}:${topic.label}`;
}

function waitForEvent(target, eventName, errorEvents = ["error"]) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, handleResolve);
      errorEvents.forEach((errorEvent) => {
        target.removeEventListener(errorEvent, handleReject);
      });
    };

    const handleResolve = () => {
      cleanup();
      resolve();
    };

    const handleReject = () => {
      cleanup();
      reject(new Error(`Video thumbnail generation failed during ${eventName}.`));
    };

    target.addEventListener(eventName, handleResolve, { once: true });
    errorEvents.forEach((errorEvent) => {
      target.addEventListener(errorEvent, handleReject, { once: true });
    });
  });
}

async function ensureVideoMetadata(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return;
  }

  await waitForEvent(video, "loadedmetadata");
}

async function ensureFirstFrame(video) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  await waitForEvent(video, "loadeddata");
}

async function seekVideo(video, targetTime) {
  const duration = Number.isFinite(video.duration) ? video.duration : targetTime;
  const safeTime = Math.max(0, Math.min(targetTime, Math.max(0, duration - 0.1)));

  if (Math.abs(video.currentTime - safeTime) < 0.05 && !video.seeking) {
    return;
  }

  const seekPromise = waitForEvent(video, "seeked");
  video.currentTime = safeTime;
  await seekPromise;
}

function captureThumbnail(video, canvas, width, height) {
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  try {
    context.clearRect(0, 0, width, height);
    context.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

function buildInitialState(videoUrl, topics, size) {
  return topics.reduce((accumulator, topic) => {
    const captureTime = topic.thumbnailTime ?? topic.time;
    const cacheKey = buildCacheKey(
      videoUrl,
      captureTime,
      size.width,
      size.height,
    );
    const cachedThumbnail = thumbnailCache.get(cacheKey);

    if (cachedThumbnail !== undefined) {
      accumulator[buildTopicKey(topic)] = cachedThumbnail
        ? { status: "ready", src: cachedThumbnail }
        : { status: "failed", src: null };
      return accumulator;
    }

    accumulator[buildTopicKey(topic)] = { status: "loading", src: null };
    return accumulator;
  }, {});
}

export function useVideoTopicThumbnails(
  videoUrl,
  topics,
  size = { width: 320, height: 180 },
) {
  const { width, height } = size;
  const [thumbnails, setThumbnails] = useState(() =>
    buildInitialState(videoUrl, topics, size),
  );

  useEffect(() => {
    const initialState = buildInitialState(videoUrl, topics, { width, height });
    setThumbnails(initialState);

    if (!videoUrl || topics.length === 0) {
      return undefined;
    }

    const uncachedTopics = topics.filter((topic) => {
      const captureTime = topic.thumbnailTime ?? topic.time;
      return !thumbnailCache.has(
        buildCacheKey(videoUrl, captureTime, width, height),
      );
    });

    if (uncachedTopics.length === 0) {
      return undefined;
    }

    let cancelled = false;
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");

    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    async function generateThumbnails() {
      try {
        await ensureVideoMetadata(video);
        await ensureFirstFrame(video);
      } catch {
        if (!cancelled) {
          setThumbnails((previous) => {
            const next = { ...previous };
            uncachedTopics.forEach((topic) => {
              const topicKey = buildTopicKey(topic);
              const captureTime = topic.thumbnailTime ?? topic.time;
              thumbnailCache.set(
                buildCacheKey(videoUrl, captureTime, width, height),
                null,
              );
              next[topicKey] = { status: "failed", src: null };
            });
            return next;
          });
        }
        return;
      }

      for (const topic of uncachedTopics) {
        if (cancelled) {
          return;
        }

        const captureTime = topic.thumbnailTime ?? topic.time;
        const cacheKey = buildCacheKey(
          videoUrl,
          captureTime,
          width,
          height,
        );
        const topicKey = buildTopicKey(topic);

        let src = null;
        try {
          await seekVideo(video, captureTime);
          src = captureThumbnail(video, canvas, width, height);
        } catch {
          src = null;
        }

        thumbnailCache.set(cacheKey, src);

        if (!cancelled) {
          setThumbnails((previous) => ({
            ...previous,
            [topicKey]: src
              ? { status: "ready", src }
              : { status: "failed", src: null },
          }));
        }
      }
    }

    void generateThumbnails();

    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [height, topics, videoUrl, width]);

  return thumbnails;
}

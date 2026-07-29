import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ChevronLeft,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  FileText,
  ImageIcon,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/auth/useAuth";
import { cn } from "@/lib/utils";
import { GiChatPanel } from "@/components/gi/GiChatPanel.jsx";
import { TranscriptText } from "@/components/gi/TranscriptText.jsx";
import {
  buildLessonVideoContext,
  isVideoPositionSharingEnabled,
} from "@/lib/lessonVideoContext";
import { useVideoTopicThumbnails } from "@/hooks/useVideoTopicThumbnails";
import { isRevealIdle, revealedSegmentCount } from "@/lib/transcriptReveal";

function formatTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getTopicThumbnailKey(topic) {
  return `${topic.time}:${topic.thumbnailTime ?? topic.time}:${topic.label}`;
}

function getTopicInitials(label) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function LessonPage() {
  const { slug = "" } = useParams();
  const auth = useAuth();
  const videoRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const frontierRef = useRef(null);

  const [course, setCourse] = useState(null);
  const [courseError, setCourseError] = useState("");
  const [courseLoading, setCourseLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("transcript");
  const [currentTime, setCurrentTime] = useState(0);
  // The furthest point playback has reached, which is what the transcript is
  // revealed against. Keyed to `currentTime` instead, seeking back to an
  // earlier timestamp would delete every segment after it — you cannot un-hear
  // a sentence, so the reveal only ever moves forward.
  const [reachedTime, setReachedTime] = useState(0);
  // The first word of the lesson starts at 0.0s, so it counts as spoken the
  // moment the page loads. Hold the whole reveal back until playback has
  // actually begun, or the panel greets the student with one stray word.
  const [hasPlayed, setHasPlayed] = useState(false);

  // Every clock update goes through here so the high-water mark cannot drift
  // out of step with the position it is derived from.
  const advanceTo = useCallback((seconds) => {
    setCurrentTime(seconds);
    setReachedTime((furthest) => (seconds > furthest ? seconds : furthest));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCourse() {
      setCourseLoading(true);
      setCourseError("");
      setCurrentTime(0);
      // A new lesson starts locked again, or its transcript would inherit the
      // previous lesson's high-water mark and open pre-revealed.
      setReachedTime(0);
      setHasPlayed(false);

      try {
        const response = await api.getCourse({
          action: "get-course",
          slug,
        });
        if (!cancelled) {
          setCourse(response);
        }
      } catch (error) {
        if (!cancelled) {
          setCourse(null);
          setCourseError(
            error instanceof Error
              ? error.message
              : "Something went wrong loading this lesson.",
          );
        }
      } finally {
        if (!cancelled) {
          setCourseLoading(false);
        }
      }
    }

    void loadCourse();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleLogout = () => {
    void auth.signOut();
  };

  const topics = course?.topics ?? [];
  const transcriptSegments = course?.transcriptSegments ?? [];
  const topicThumbnails = useVideoTopicThumbnails(course?.videoUrl ?? "", topics);

  // Timestamped transcript handed to the chatbot so students can ask about
  // moments in the video ("at 8:30, what does that mean?").
  const lessonContext = useMemo(() => buildLessonVideoContext(course), [course]);

  // Read straight off the media element rather than from the currentTime state,
  // so the chat engine can poll on its own schedule instead of re-rendering
  // with every timeupdate. Lets the student ask "what does she mean here?".
  const getVideoPosition = useCallback(() => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.currentTime)) return null;
    return { seconds: video.currentTime, paused: Boolean(video.paused) };
  }, []);
  const videoPositionEnabled = isVideoPositionSharingEnabled(import.meta.env);

  let activeTopicIndex = 0;
  for (let index = topics.length - 1; index >= 0; index -= 1) {
    if (currentTime >= topics[index].time) {
      activeTopicIndex = index;
      break;
    }
  }

  let activeTranscriptIndex = 0;
  for (let index = transcriptSegments.length - 1; index >= 0; index -= 1) {
    if (currentTime >= transcriptSegments[index].time) {
      activeTranscriptIndex = index;
      break;
    }
  }

  // Scrubbing counts as starting: the clock has moved even though `play` never
  // fired, and the student is plainly asking to see that part of the lesson.
  const hasStarted = hasPlayed || reachedTime > 0;

  // Segments the student has reached carry their transcript; the rest render as
  // a header-only row — clickable, so the transcript stays a way to navigate,
  // but carrying no text, so there is still nothing to read ahead.
  const unlockedCount = hasStarted
    ? revealedSegmentCount(transcriptSegments, reachedTime)
    : 0;
  const isTranscriptIdle =
    transcriptSegments.length > 0 &&
    (!hasStarted || isRevealIdle(transcriptSegments, reachedTime));

  const seekTo = (seconds) => {
    advanceTo(seconds);

    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
    }

    if (window.matchMedia("(max-width: 1023px)").matches) {
      setSidebarOpen(false);
    }
  };

  // `timeupdate` only fires about 4x a second, which is coarser than the words
  // it now drives (~0.3s each) — the transcript would visibly lag the audio.
  // While playing, sample the media clock on a frame loop instead, but only
  // push state at ~10Hz: the chat panel is mounted alongside this page, and
  // re-rendering it 60 times a second to move one highlight is not worth it.
  const REVEAL_RESOLUTION_SECONDS = 0.1;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    let frame = 0;
    let last = -1;

    const sample = () => {
      const now = video.currentTime;
      if (Math.abs(now - last) >= REVEAL_RESOLUTION_SECONDS) {
        last = now;
        advanceTo(now);
      }
      frame = window.requestAnimationFrame(sample);
    };

    const start = () => {
      setHasPlayed(true);
      if (!frame) frame = window.requestAnimationFrame(sample);
    };
    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      // Land on the exact position so a pause does not leave the reveal
      // stranded up to 100ms short of where the audio actually stopped.
      advanceTo(video.currentTime);
    };

    video.addEventListener('play', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    if (!video.paused) start();

    return () => {
      video.removeEventListener('play', start);
      video.removeEventListener('pause', stop);
      video.removeEventListener('ended', stop);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [advanceTo]);

  // Keep the segment that is still arriving in view as it grows, but yield the
  // moment the student scrolls it off-screen to read something else — pulling
  // them back mid-sentence is worse than letting the reveal continue unseen.
  // Scrolling it back into view resumes the follow.
  const TRANSCRIPT_FOLLOW_MARGIN_PX = 12;

  const followFrontier = useCallback(() => {
    const panel = transcriptScrollRef.current;
    const frontier = frontierRef.current;
    if (!panel || !frontier) return;

    const panelBox = panel.getBoundingClientRect();
    const frontierBox = frontier.getBoundingClientRect();

    const isOnScreen =
      frontierBox.bottom > panelBox.top && frontierBox.top < panelBox.bottom;
    if (!isOnScreen) return;

    const overshoot = frontierBox.bottom - panelBox.bottom;
    if (overshoot > 0) {
      panel.scrollTop += overshoot + TRANSCRIPT_FOLLOW_MARGIN_PX;
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "transcript") return;
    followFrontier();
  }, [reachedTime, activeTab, followFrontier]);

  // Returning from the chat tab lands on the frontier rather than on wherever
  // the reveal happened to be when the student left it.
  useEffect(() => {
    if (activeTab !== "transcript") return;

    const frontier = frontierRef.current;
    if (frontier) frontier.scrollIntoView({ block: "nearest" });
  }, [activeTab]);

  // Still needed for movement that happens without a frame loop running:
  // scrubbing or a transcript click while the video is paused.
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      advanceTo(videoRef.current.currentTime);
    }
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-surface text-ink">
      <header className="relative z-[60] flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white pl-2 pr-4 lg:pl-3 lg:pr-6">
        {!sidebarOpen ? (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-slate-100 hover:text-ink"
            aria-label="Show content outline"
            title="Show content outline"
          >
            <PanelLeftOpen className="size-5" />
          </button>
        ) : (
          <span className="size-8" aria-hidden="true" />
        )}

        <h1 className="pointer-events-none absolute left-1/2 max-w-[48%] -translate-x-1/2 truncate text-center text-sm font-semibold text-slate-800 sm:max-w-[55%] sm:text-base">
          {course?.title ?? "Lesson"}
        </h1>

        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg p-1.5 text-ink-muted transition hover:bg-red-50/50 hover:text-red-600 cursor-pointer"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="size-5" />
        </button>
      </header>

      <div className="relative flex flex-1 min-h-0 flex-row">
        {sidebarOpen ? (
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
            aria-label="Close content outline"
          />
        ) : null}

        <aside
          className={cn(
            "shrink-0 border-r border-slate-200 bg-white transition-all duration-300 ease-in-out",
            sidebarOpen
              ? "fixed inset-y-0 left-0 z-[70] flex w-72 flex-col sm:w-80 lg:relative lg:-mt-14 lg:h-[calc(100%+3.5rem)]"
              : "hidden",
          )}
        >
          {sidebarOpen ? (
            <>
              <div className="relative w-full shrink-0 border-b border-slate-100 p-3">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-primary transition hover:bg-slate-100"
                >
                  <ChevronLeft className="size-4" />
                  <span>Back</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="absolute right-3 top-3 rounded-lg p-2 text-ink-muted transition hover:bg-slate-100 hover:text-ink"
                  aria-label="Hide content outline"
                  title="Hide content outline"
                >
                  <PanelLeftClose className="size-5" />
                </button>
              </div>

              <div className="w-full shrink-0 p-4">
                <h2 className="truncate text-lg font-bold text-slate-800">
                  Content Outline
                </h2>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {topics.map((topic, index) => {
                  const isActive = activeTopicIndex === index;
                  const thumbnail = topicThumbnails[getTopicThumbnailKey(topic)] ?? {
                    status: "loading",
                    src: null,
                  };
                  return (
                    <button
                      key={`${topic.time}-${topic.label}`}
                      type="button"
                      onClick={() => seekTo(topic.time)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "w-full rounded-2xl border p-3 text-left transition-all duration-200 cursor-pointer",
                        isActive
                          ? "border-primary/30 bg-primary-soft shadow-sm"
                          : "border-slate-100 hover:border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                        <div className="relative aspect-video overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100">
                          {thumbnail.status === "ready" && thumbnail.src ? (
                            <img
                              src={thumbnail.src}
                              alt=""
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : thumbnail.status === "loading" ? (
                            <div className="h-full w-full animate-pulse bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200" />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-primary-soft to-primary/10 px-2 text-center text-primary">
                              <ImageIcon className="size-4 opacity-70" />
                              <span className="text-[10px] font-semibold tracking-[0.2em]">
                                {getTopicInitials(topic.label) || "GI"}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 pt-0.5">
                          <p
                            className={cn(
                              "text-[11px] font-bold tracking-wide",
                              isActive ? "text-primary" : "text-slate-500",
                            )}
                          >
                            {formatTimestamp(topic.time)}
                          </p>
                          <h4
                            className={cn(
                              "mt-1 line-clamp-2 text-xs font-semibold leading-snug",
                              isActive ? "text-primary" : "text-slate-700",
                            )}
                          >
                            {topic.label}
                          </h4>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </aside>

        <main className="flex flex-1 min-h-0 flex-col overflow-y-auto bg-slate-50 p-4 pb-32 sm:p-6 sm:pb-40">
          <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6">
            {courseLoading ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
                Loading lesson...
              </div>
            ) : courseError ? (
              <div className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
                <p className="text-sm text-red-600">{courseError}</p>
              </div>
            ) : course ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-sm leading-relaxed text-slate-600">
                    {course.description}
                  </p>
                </div>

                <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-slate-200/50 bg-black shadow-xl">
                  <video
                    ref={videoRef}
                    src={course.videoUrl}
                    crossOrigin="anonymous"
                    controls
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    className="h-full w-full object-contain"
                  />
                </div>

                <div className="flex h-[clamp(20rem,45dvh,34rem)] shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                  <div className="flex shrink-0 border-b border-slate-100 bg-slate-50/50 p-2">
                    <div className="grid w-full grid-cols-2 rounded-lg bg-slate-100 p-1 sm:flex sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setActiveTab("transcript")}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer",
                          activeTab === "transcript"
                            ? "bg-white text-primary shadow"
                            : "text-slate-500 hover:text-slate-800",
                        )}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Transcript</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab("chatbot")}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer",
                          activeTab === "chatbot"
                            ? "bg-white text-primary shadow"
                            : "text-slate-500 hover:text-slate-800",
                        )}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        <span>AI Chatbot</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-1 min-h-0 flex-col">
                    <div
                      ref={transcriptScrollRef}
                      className={cn(
                        "lesson-transcript-scrollbar flex-1 space-y-4 overscroll-contain overflow-y-auto p-3 sm:p-5",
                        activeTab !== "transcript" && "hidden",
                      )}
                    >
                        {isTranscriptIdle && (
                          <p className="px-3 text-xs italic text-slate-400">
                            The transcript fills in here as the lesson plays.
                            Jump to any timestamp below.
                          </p>
                        )}

                        {transcriptSegments.map((segment, index) => {
                          const isActive = activeTranscriptIndex === index;
                          // Not reached yet: a clickable header, no transcript.
                          const isLocked = index >= unlockedCount;
                          // The one still arriving, which the panel follows.
                          const isFrontier = index === unlockedCount - 1;
                          return (
                            <button
                              key={`${segment.time}-${segment.title}`}
                              ref={isFrontier ? frontierRef : undefined}
                              type="button"
                              onClick={() => seekTo(segment.time)}
                              aria-label={`Play video from ${formatTimestamp(segment.time)}: ${segment.title}`}
                              className={cn(
                                "group block w-full cursor-pointer rounded-xl border border-transparent text-left transition-all duration-200",
                                isLocked ? "px-3 py-1.5" : "p-3",
                                isActive
                                  ? "border-slate-100 bg-slate-50 shadow-sm"
                                  : "hover:bg-slate-50/50",
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={cn(
                                    "mt-0.5 inline-flex h-5 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-bold transition-colors",
                                    isActive
                                      ? "bg-primary text-white"
                                      : isLocked
                                        ? "bg-slate-50 text-slate-300 group-hover:bg-slate-100 group-hover:text-slate-500"
                                        : "bg-slate-100 text-slate-400 group-hover:bg-slate-200 group-hover:text-slate-600",
                                  )}
                                >
                                  {formatTimestamp(segment.time)}
                                </span>
                                <div>
                                  <h4
                                    className={cn(
                                      "text-xs font-bold transition-colors",
                                      isActive
                                        ? "text-primary"
                                        : isLocked
                                          ? "text-slate-300 group-hover:text-slate-500"
                                          : "text-slate-700 group-hover:text-slate-800",
                                    )}
                                  >
                                    {segment.title}
                                  </h4>
                                  {!isLocked && (
                                    <p className="mt-1.5 text-xs leading-relaxed">
                                      <TranscriptText
                                        segment={segment}
                                        currentTime={currentTime}
                                        reachedTime={reachedTime}
                                        isActiveSegment={isActive}
                                      />
                                    </p>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}

                    </div>

                    {/* Kept mounted across tab switches. Unmounting tears down the
                        live voice session and cuts reply audio mid-sentence. */}
                    <div
                      className={cn(
                        "flex min-h-0 flex-1 flex-col",
                        activeTab === "transcript" && "hidden",
                      )}
                    >
                      <GiChatPanel
                        emptyHint="Ask about this lesson — click the mic to start"
                        lessonContext={lessonContext}
                        getVideoPosition={videoPositionEnabled ? getVideoPosition : null}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            <div className="h-48 shrink-0 sm:h-64" aria-hidden="true" />
          </div>
        </main>
      </div>
    </div>
  );
}

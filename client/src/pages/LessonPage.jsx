import { useEffect, useRef, useState } from "react";
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
import { useVideoTopicThumbnails } from "@/hooks/useVideoTopicThumbnails";

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

  const [course, setCourse] = useState(null);
  const [courseError, setCourseError] = useState("");
  const [courseLoading, setCourseLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("transcript");
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadCourse() {
      setCourseLoading(true);
      setCourseError("");
      setCurrentTime(0);

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

  const seekTo = (seconds) => {
    setCurrentTime(seconds);

    if (videoRef.current) {
      videoRef.current.currentTime = seconds;
      videoRef.current.play().catch(() => {});
    }

    if (window.matchMedia("(max-width: 1023px)").matches) {
      setSidebarOpen(false);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
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
                <h2 className="truncate text-sm font-bold text-slate-800">
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
                              "mt-1 line-clamp-2 text-sm font-semibold leading-tight",
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
                    onTimeUpdate={handleTimeUpdate}
                    className="h-full w-full object-contain"
                  />
                </div>

                <div className="flex min-h-[460px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm sm:min-h-[500px]">
                  <div className="flex shrink-0 border-b border-slate-100 bg-slate-50/50 p-2">
                    <div className="flex rounded-lg bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setActiveTab("transcript")}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer",
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
                          "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold transition cursor-pointer",
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
                      className={cn(
                        "flex-1 space-y-4 overflow-y-auto p-5",
                        activeTab !== "transcript" && "hidden",
                      )}
                    >
                        {transcriptSegments.map((segment, index) => {
                          const isActive = activeTranscriptIndex === index;
                          return (
                            <div
                              key={`${segment.time}-${segment.title}`}
                              onClick={() => seekTo(segment.time)}
                              className={cn(
                                "group cursor-pointer rounded-xl border border-transparent p-3 transition-all duration-200",
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
                                        : "text-slate-700 group-hover:text-slate-800",
                                    )}
                                  >
                                    {segment.title}
                                  </h4>
                                  <p
                                    className={cn(
                                      "mt-1.5 text-xs leading-relaxed transition-colors",
                                      isActive
                                        ? "font-medium text-slate-800"
                                        : "text-slate-500",
                                    )}
                                  >
                                    {segment.text}
                                  </p>
                                </div>
                              </div>
                            </div>
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
                      <GiChatPanel emptyHint="Ask about this lesson — click the mic to start" />
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

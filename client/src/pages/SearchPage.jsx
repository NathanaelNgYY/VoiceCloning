import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, LogOut, ArrowRight, BookOpenText } from "lucide-react";
import { api } from "@/api/client";
import { useAuth } from "@/auth/useAuth";

export function SearchPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError("");

    try {
      const response = await api.searchCourses({
        action: "search-courses",
        query: query.trim(),
      });
      setResults(response.results ?? []);
    } catch (searchError) {
      setResults([]);
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Something went wrong searching for courses.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    void auth.signOut();
  };

  const openLesson = (slug) => {
    navigate(`/lesson/${slug}`);
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-slate-50 text-ink overflow-hidden">
      {/* Background ambient glows */}
      <div className="absolute top-0 -left-4 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 pointer-events-none" />
      <div className="absolute bottom-0 -right-4 w-96 h-96 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 pointer-events-none" />

      {/* Grid background */}
      <div 
        className="absolute inset-0 z-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(hsl(var(--primary)) 1px, transparent 1px)`,
          backgroundSize: "24px 24px"
        }}
      />

      {/* Header with Logout */}
      <header className="relative z-10 flex h-16 items-center justify-end px-6">
        <button
          type="button"
          onClick={handleLogout}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 transition hover:bg-red-50/50 hover:text-red-600"
          title="Sign out"
        >
          <LogOut className="size-4" />
          <span>Sign out</span>
        </button>
      </header>

      {/* Center Search Input */}
      <main className="relative z-10 flex flex-1 flex-col items-center px-4 pb-24 pt-8 sm:pt-14">
        <div className="w-full max-w-3xl text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mb-2">
            LKCMedicine Lectures
          </h1>

          <p className="mx-auto max-w-xl text-sm leading-relaxed text-slate-500">
            Search for a lesson title or topic to open its learning page with video,
            transcript, and embedded AI support.
          </p>

          <form onSubmit={handleSearch} className="relative group">
            <div className="relative flex items-center">
              <Search className="absolute left-5 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors duration-200" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="GI Bleeding"
                className="w-full rounded-full border border-slate-200 bg-white py-[1.125rem] pl-14 pr-16 text-base font-medium text-slate-900 shadow-lg shadow-slate-100/50 outline-none transition-all duration-200 focus:border-slate-300 focus:ring-2 focus:ring-primary/10 focus:shadow-xl focus:shadow-slate-200/40 placeholder:text-slate-400"
                autoFocus
              />
              <button
                type="submit"
                disabled={!query.trim() || loading}
                className="absolute right-3.5 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white transition-all duration-200 hover:bg-primary/90 active:scale-95 disabled:bg-slate-100 disabled:text-slate-400 disabled:scale-100 cursor-pointer"
              >
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </form>

          {error ? (
            <p className="mt-4 text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-8 text-left">
            {loading ? (
              <div className="rounded-3xl border border-slate-200 bg-white/80 p-6 text-sm text-slate-500 shadow-sm">
                Searching lessons...
              </div>
            ) : results.length > 0 ? (
              <div className="space-y-3">
                {results.map((course) => (
                  <button
                    key={course.slug}
                    type="button"
                    onClick={() => openLesson(course.slug)}
                    className="w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md cursor-pointer"
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                        <BookOpenText className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-semibold text-slate-900">
                            {course.title}
                          </h2>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {course.matchSummary}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                          {course.description}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : query.trim() ? (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/70 p-6 text-sm text-slate-500 shadow-sm">
                No lessons matched your search.
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-white/70 p-6 text-sm text-slate-500 shadow-sm">
                Start with <span className="font-semibold text-slate-700">GI Bleeding</span> to
                open the first lesson.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

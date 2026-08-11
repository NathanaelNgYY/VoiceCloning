import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { config } from '@/config';
import { conceptStatusLabel, lessonAnalytics, SIGNAL_LABELS, SUPPORT_THRESHOLDS } from '@/lib/supervisorAnalytics';
import {
  getSupervisorConceptCohort,
  getSupervisorUser,
  getSupervisorUserEvents,
  listSupervisorUsers,
  resetSupervisorConcept,
} from '@/services/learnerAnalytics';

const EVENT_LABELS = Object.freeze({
  lesson_session_started: 'Lesson opened',
  lesson_session_ended: 'Lesson closed',
  lesson_tab_viewed: 'Lesson tab viewed',
  lesson_navigation: 'Lesson navigation',
  video_play: 'Video played',
  video_pause: 'Video paused',
  video_seek: 'Video position changed',
  video_rewind: 'Video rewinds',
  video_forward_seek: 'Forward seeks',
  video_ended: 'Video completed',
  transcript_scrolled: 'Transcript reviewed',
  question_asked: 'Question asked',
  repeated_question: 'Similar question repeated',
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}

function AdminSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-label="Loading admin analytics">
      <div className="h-48 rounded-3xl bg-slate-200/70" />
      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <div className="h-72 rounded-3xl bg-slate-200/70" />
        <div className="h-72 rounded-3xl bg-slate-200/70" />
      </div>
    </div>
  );
}

function CohortOverview({ cohort }) {
  const [filter, setFilter] = useState('all');
  const [graphReady, setGraphReady] = useState(false);
  const concepts = useMemo(() => {
    const values = [...(cohort?.concepts || [])];
    if (filter === 'recommended') return values.filter((item) => item.supportRecommendedLearners > 0);
    if (filter === 'possible') return values.filter((item) => item.possibleSupportLearners > 0);
    return values;
  }, [cohort, filter]);
  const recommendedTotal = (cohort?.concepts || []).reduce(
    (sum, concept) => sum + concept.supportRecommendedLearners, 0,
  );
  const possibleTotal = (cohort?.concepts || []).reduce(
    (sum, concept) => sum + concept.possibleSupportLearners, 0,
  );
  const maxCount = Math.max(1, ...(cohort?.concepts || []).flatMap((concept) => [
    concept.supportRecommendedLearners,
    concept.possibleSupportLearners,
  ]));

  useEffect(() => {
    setGraphReady(false);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setGraphReady(true);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => setGraphReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, [cohort, filter]);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white shadow-[0_20px_50px_-35px_rgba(15,23,42,0.35)]" aria-labelledby="cohort-heading">
      <div className="grid xl:grid-cols-[0.65fr_1.35fr]">
        <div className="border-b border-slate-200 p-6 sm:p-8 xl:border-b-0 xl:border-r">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">Cohort overview</p>
          <h2 id="cohort-heading" className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Where learners may benefit from support
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Behavioural signals are prompts for review, not grades or proof that a learner is struggling.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-slate-200 pt-6">
            <div>
              <span className="block font-mono text-3xl font-semibold text-slate-950">{cohort?.totalLearners || 0}</span>
              <span className="text-xs text-slate-500">Identified learners</span>
            </div>
            <div>
              <span className="block font-mono text-3xl font-semibold text-rose-800">{recommendedTotal}</span>
              <span className="text-xs text-slate-500">Recommended-support states</span>
            </div>
            <div>
              <span className="block font-mono text-3xl font-semibold text-amber-700">{possibleTotal}</span>
              <span className="text-xs text-slate-500">Possible-support states</span>
            </div>
            <div>
              <span className="block font-mono text-3xl font-semibold text-slate-950">{cohort?.concepts?.length || 0}</span>
              <span className="text-xs text-slate-500">Authored concepts</span>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Concept ranking</h3>
              <p className="mt-1 text-xs text-slate-500">Sorted by support recommended, then possible support.</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <div className="flex rounded-xl bg-slate-100 p-1" aria-label="Filter concept ranking">
                {[
                  ['all', 'All'],
                  ['recommended', 'Recommended'],
                  ['possible', 'Possible'],
                ].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition active:scale-[0.98] ${filter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {concepts.length > 0 && (
            <div className="mt-8" role="img" aria-label="Grouped vertical bar chart of learner support states by concept">
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                <div className="grid min-w-[680px] grid-cols-[2rem_1fr] gap-3">
                  <div className="flex h-52 flex-col justify-between pb-7 text-right font-mono text-[10px] text-slate-400">
                    <span>{maxCount}</span>
                    <span>{Math.round((maxCount / 2) * 10) / 10}</span>
                    <span>0</span>
                  </div>
                  <div>
                    <div className="relative h-44 border-b border-slate-300 bg-[linear-gradient(to_bottom,transparent_49.5%,rgb(226_232_240)_50%,transparent_50.5%)]">
                      <div className="absolute inset-0 flex items-end justify-around gap-3 px-2">
                        {concepts.map((concept, index) => (
                          <div key={concept.conceptId} className="flex h-full min-w-12 flex-1 items-end justify-center gap-1.5">
                            {[
                              ['recommended', concept.supportRecommendedLearners, 'bg-rose-700'],
                              ['possible', concept.possibleSupportLearners, 'bg-amber-400'],
                            ].map(([kind, count, colour], barIndex) => (
                              <div key={kind} className="flex h-full w-5 flex-col justify-end sm:w-7">
                                {count > 0 && <span className="mb-1 text-center font-mono text-[10px] font-semibold text-slate-600">{count}</span>}
                                <div className={`h-[calc(100%-1.25rem)] origin-bottom rounded-t-md ${colour} transition-transform duration-700`} style={{ transform: `scaleY(${graphReady ? count / maxCount : 0})`, transitionDelay: `${index * 55 + barIndex * 80}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }} />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-around gap-3 pt-2">
                      {concepts.map((concept, index) => (
                        <span key={concept.conceptId} className="min-w-12 flex-1 text-center font-mono text-[10px] text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <ol className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {concepts.map((concept, index) => (
                  <li key={concept.conceptId} className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-2 border-t border-slate-100 py-2 text-xs">
                    <span className="font-mono text-[10px] text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                    <span className="font-medium text-slate-700">{concept.conceptLabel}</span>
                    <span className="whitespace-nowrap font-mono text-[10px] text-slate-500"><b className="text-rose-700">{concept.supportRecommendedLearners} R</b> · <b className="text-amber-700">{concept.possibleSupportLearners} P</b></span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {concepts.length === 0 && <p className="mt-6 rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">No concepts match this filter yet.</p>}
          <div className="mt-5 flex flex-wrap gap-4 border-t border-slate-200 pt-4 text-xs text-slate-500">
            <span><i className="mr-1.5 inline-block size-2 rounded-full bg-rose-700" />Support recommended</span>
            <span><i className="mr-1.5 inline-block size-2 rounded-full bg-amber-400" />Possible support</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function EvidenceList({ events, resetKey }) {
  const [visibleCount, setVisibleCount] = useState(5);
  useEffect(() => setVisibleCount(5), [resetKey]);
  const visibleEvents = events.slice(0, visibleCount);
  return (
    <>
      <ol className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-3">
        {visibleEvents.map((evidence, eventIndex) => (
          <li key={evidence.eventId || `${evidence.signal}-${eventIndex}`} className="grid gap-1 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <span className="text-sm font-medium text-slate-800">{SIGNAL_LABELS[evidence.signal] || evidence.signal.replaceAll('_', ' ')}</span>
              <span className="ml-2 font-mono text-[11px] font-semibold text-sky-700">+{Number(evidence.effectiveContribution || 0).toFixed(3)} now</span>
              <span className="ml-2 font-mono text-[10px] text-slate-400">base {Number(evidence.weight || 0).toFixed(1)}</span>
            </div>
            <time className="font-mono text-[11px] text-slate-500">{formatDate(evidence.occurredAt)}</time>
          </li>
        ))}
        {events.length === 0 && <li className="py-3 text-xs text-slate-500">Detailed event timestamps are unavailable for legacy aggregate evidence.</li>}
      </ol>
      {events.length > 5 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">Showing {Math.min(visibleCount, events.length)} of {events.length}</span>
          <div className="flex gap-2">
            {visibleCount > 5 && <button type="button" onClick={() => setVisibleCount(5)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 active:scale-[0.98]">Show less</button>}
            {visibleCount < events.length && <button type="button" onClick={() => setVisibleCount((count) => Math.min(count + 5, events.length))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98]">Show 5 more</button>}
          </div>
        </div>
      )}
    </>
  );
}

function QuestionsPanel({ loading, error, oid, questions = [] }) {
  const [visibleCount, setVisibleCount] = useState(5);
  useEffect(() => setVisibleCount(5), [oid]);

  if (loading) return <div className="space-y-3 animate-pulse">{[1, 2, 3].map((key) => <div key={key} className="h-20 rounded-xl bg-slate-200/70" />)}</div>;
  if (error) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (questions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-slate-700">No stored questions yet</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">No learner questions were found in the retained conversation history.</p>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Learner questions</h3>
          <p className="mt-1 text-xs text-slate-500">Newest first · retained for learning review</p>
        </div>
        <span className="font-mono text-xs text-slate-500">{questions.length} total</span>
      </div>
      <ol className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-4">
        {questions.slice(0, visibleCount).map((question) => (
          <li key={question.id} className="py-4">
            <div className="flex flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{question.questionText}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
              <time>{formatDate(question.occurredAt)}</time>
              <span>conversation history</span>
            </div>
          </li>
        ))}
      </ol>
      {questions.length > 5 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">Showing {Math.min(visibleCount, questions.length)} of {questions.length}</span>
          <div className="flex gap-2">
            {visibleCount > 5 && <button type="button" onClick={() => setVisibleCount(5)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 active:scale-[0.98]">Show less</button>}
            {visibleCount < questions.length && <button type="button" onClick={() => setVisibleCount((count) => Math.min(count + 5, questions.length))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98]">Show 5 more</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function EventTimeline({ state }) {
  const [visibleCount, setVisibleCount] = useState(10);
  const events = useMemo(
    () => [...state.events].sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()),
    [state.events],
  );
  const actionCounts = useMemo(() => {
    const counts = new Map();
    events.forEach((event) => {
      let key = event.eventName;
      if (event.eventName === 'video_seek') {
        key = event.properties?.direction === 'backward' ? 'video_rewind' : 'video_forward_seek';
      }
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count, label: EVENT_LABELS[key] || key.replaceAll('_', ' ') }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  }, [events]);

  useEffect(() => setVisibleCount(10), [state.oid]);

  if (state.loading) {
    return <div className="space-y-3 animate-pulse">{[1, 2, 3].map((key) => <div key={key} className="h-16 rounded-xl bg-slate-200/70" />)}</div>;
  }
  if (state.error) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>;
  if (state.events.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">No stored lesson actions were found for this learner.</p>;
  }
  return (
    <div className="space-y-5">
      {state.truncated && (
        <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Showing the newest 500 actions. Older stored events were not returned.</p>
      )}
      <section aria-labelledby="event-summary-heading" className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4 id="event-summary-heading" className="text-sm font-semibold text-slate-900">Action summary</h4>
            <p className="mt-1 text-xs text-slate-500">Counts from the stored actions returned for this learner.</p>
          </div>
          <p className="font-mono text-2xl font-semibold text-slate-950">{events.length} <span className="text-xs font-normal text-slate-500">total</span></p>
        </div>
        <dl className="mt-4 flex flex-wrap gap-2">
          {actionCounts.map((action) => (
            <div key={action.key} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <dt className="text-xs text-slate-600">{action.label}</dt>
              <dd className="font-mono text-xs font-semibold text-slate-950">{action.count}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-900">Latest actions</h4>
          <span className="text-xs text-slate-500">Showing {Math.min(visibleCount, events.length)} of {events.length}</span>
        </div>
        <ol className="divide-y divide-slate-200 border-y border-slate-200">
        {events.slice(0, visibleCount).map((event) => (
          <li key={`${event.batchId}:${event.eventId}`} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr_auto] sm:items-center">
            <time className="font-mono text-[11px] text-slate-500">{formatDate(event.occurredAt)}</time>
            <div>
              <p className="text-sm font-medium text-slate-800">{EVENT_LABELS[event.eventName] || event.eventName.replaceAll('_', ' ')}</p>
              <p className="text-xs text-slate-500">{event.lessonSlug}{Number.isFinite(event.videoTime) ? ` · ${Math.floor(event.videoTime / 60)}:${String(Math.floor(event.videoTime % 60)).padStart(2, '0')}` : ''}</p>
            </div>
            {event.properties?.direction && <span className="text-xs text-slate-500">{event.properties.direction}</span>}
          </li>
        ))}
        </ol>
        {visibleCount < events.length && (
          <button type="button" onClick={() => setVisibleCount((count) => Math.min(count + 10, events.length))} className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:scale-[0.99]">
            Show 10 more
          </button>
        )}
      </div>
    </div>
  );
}

export function SupervisorDashboardPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [cohort, setCohort] = useState(null);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [resettingConcept, setResettingConcept] = useState('');
  const [eventState, setEventState] = useState({ loading: false, error: '', events: [], truncated: false, oid: '' });

  useEffect(() => {
    let active = true;
    Promise.all([listSupervisorUsers(), getSupervisorConceptCohort('gi-bleeding')])
      .then(([items, result]) => {
        if (!active) return;
        setUsers(items);
        setCohort(result);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.status === 403
          ? 'Your account does not have admin analytics access.'
          : 'The admin analytics dashboard could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selected?.oid) return undefined;
    let active = true;
    setEventState({ loading: true, error: '', events: [], truncated: false, oid: selected.oid });
    getSupervisorUserEvents(selected.oid)
      .then((result) => {
        if (active) setEventState({ loading: false, error: '', events: result.events || [], truncated: Boolean(result.truncated), oid: selected.oid });
      })
      .catch(() => {
        if (active) setEventState({ loading: false, error: 'Stored actions could not be loaded.', events: [], truncated: false, oid: selected.oid });
      });
    return () => { active = false; };
  }, [selected?.oid]);

  if (!config.giAuthEnabled) return <Navigate to="/" replace />;

  async function selectUser(user) {
    setError('');
    setActiveTab('summary');
    try {
      setSelected({ ...(await getSupervisorUser(user.oid)), oid: user.oid });
    } catch {
      setError('This learner record could not be loaded.');
    }
  }

  async function resetConcept(lessonSlug, concept) {
    if (!window.confirm(`Reset ${concept.conceptLabel} evidence for this learner? This cannot be undone.`)) return;
    const key = `${lessonSlug}:${concept.conceptId}`;
    setResettingConcept(key);
    setError('');
    try {
      await resetSupervisorConcept(selected.oid, lessonSlug, concept.conceptId);
      setSelected({ ...(await getSupervisorUser(selected.oid)), oid: selected.oid });
      setCohort(await getSupervisorConceptCohort('gi-bleeding'));
    } catch {
      setError('The concept evidence could not be reset.');
    } finally {
      setResettingConcept('');
    }
  }

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 py-6 text-slate-900 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-800">Admin analytics</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Learner support signals</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Review cohort patterns, inspect individual evidence, and audit stored lesson actions.</p>
          </div>
          <button type="button" onClick={() => navigate('/')} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:-translate-y-px">
            Back to lessons
          </button>
        </header>

        {error && <p className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
        {loading ? <AdminSkeleton /> : (
          <>
            {cohort && <CohortOverview cohort={cohort} />}

            <section className="mt-8 grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]" aria-label="Student analytics">
              <aside className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_40px_-35px_rgba(15,23,42,0.35)]">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-sm font-semibold text-slate-900">Students</h2>
                  <p className="mt-1 text-xs text-slate-500">{users.length} identified learner{users.length === 1 ? '' : 's'}</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <button
                      key={user.oid}
                      type="button"
                      onClick={() => selectUser(user)}
                      className={`block w-full px-5 py-4 text-left transition active:scale-[0.99] ${selected?.oid === user.oid ? 'bg-sky-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="block text-sm font-semibold text-slate-900">{user.displayName || 'Unnamed learner'}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">{user.email}</span>
                      <span className="mt-2 block text-[11px] text-slate-400">Last seen {formatDate(user.lastSeenAt)}</span>
                    </button>
                  ))}
                  {users.length === 0 && <p className="p-5 text-sm text-slate-500">No identified learner activity yet.</p>}
                </div>
              </aside>

              <section className="min-h-72 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-35px_rgba(15,23,42,0.35)] sm:p-6">
                {!selected ? (
                  <div className="flex min-h-60 items-center justify-center text-center">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Select a student</p>
                      <p className="mt-1 text-sm text-slate-500">Their support summary, signal detail, and stored actions will appear here.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-semibold text-slate-950">{selected.profile?.displayName || 'Learner'}</h2>
                    <p className="mt-1 text-sm text-slate-500">{selected.profile?.email}</p>
                    <div className="mt-5 flex gap-1 border-b border-slate-200" role="tablist" aria-label="Learner detail">
                      {[
                        ['summary', 'Summary'],
                        ['signals', 'Learning signals'],
                        ['questions', 'Questions'],
                        ['events', 'Events'],
                      ].map(([value, label]) => (
                        <button key={value} type="button" role="tab" aria-selected={activeTab === value} onClick={() => setActiveTab(value)} className={`border-b-2 px-3 py-2 text-sm font-medium transition active:-translate-y-px ${activeTab === value ? 'border-sky-700 text-sky-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-5">
                      {activeTab === 'events' ? <EventTimeline state={eventState} /> : activeTab === 'questions' ? <QuestionsPanel oid={selected.oid} questions={selected.questions || []} /> : (
                        <div className="space-y-4">
                          {(selected.lessons || []).length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">No lesson evidence has been recorded for this learner yet.</p>}
                          {(selected.lessons || []).map((lesson) => {
                            const analytics = lessonAnalytics(lesson);
                            const concepts = activeTab === 'signals' ? analytics.concepts : analytics.visibleConcepts;
                            return (
                              <div key={lesson.SK || lesson.lessonSlug} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <h3 className="text-sm font-semibold text-slate-900">{lesson.lessonSlug}</h3>
                                    <p className="mt-1 text-xs text-slate-500">Updated {formatDate(lesson.updatedAt)}</p>
                                  </div>
                                  <span className="font-mono text-xs text-slate-500">{analytics.totalEvidence} evidence events</span>
                                </div>
                                {activeTab === 'summary' && <p className="mt-4 text-sm leading-6 text-slate-700">{lesson.summary}</p>}
                                <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
                                  {concepts.map((concept) => (
                                    <div key={concept.conceptId} className="py-4">
                                      <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                          <p className="text-sm font-semibold text-slate-900">{concept.conceptLabel}</p>
                                          <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${concept.status === 'support_recommended' ? 'bg-rose-100 text-rose-800' : concept.status === 'possible_support' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-600'}`}>
                                            {conceptStatusLabel(concept.status)}
                                          </span>
                                        </div>
                                        {concept.status !== 'no_support_inference' && (
                                          <button type="button" onClick={() => resetConcept(lesson.lessonSlug, concept)} disabled={resettingConcept === `${lesson.lessonSlug}:${concept.conceptId}`} className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 active:-translate-y-px disabled:opacity-60">
                                            {resettingConcept === `${lesson.lessonSlug}:${concept.conceptId}` ? 'Resetting…' : 'Reset evidence'}
                                          </button>
                                        )}
                                      </div>
                                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                                          <span className="block font-mono text-xl font-semibold text-slate-950">{concept.evidenceScore.toFixed(2)}</span>
                                          <span className="text-[11px] text-slate-500">Current score · recommended ≥ {SUPPORT_THRESHOLDS.recommended}</span>
                                        </div>
                                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                                          <span className="block font-mono text-xl font-semibold text-slate-950">{concept.evidenceCount}</span>
                                          <span className="text-[11px] text-slate-500">Qualifying events</span>
                                        </div>
                                        <div className="col-span-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:col-span-1">
                                          <span className="block font-mono text-xl font-semibold text-slate-950">{concept.signals.length}</span>
                                          <span className="text-[11px] text-slate-500">Signal types</span>
                                        </div>
                                      </div>
                                      {activeTab === 'signals' && (
                                        <div className="mt-4">
                                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Qualifying evidence</p>
                                          <EvidenceList events={concept.evidenceEvents || []} resetKey={`${selected.oid}:${lesson.lessonSlug}:${concept.conceptId}`} />
                                          <p className="mt-2 text-xs leading-5 text-slate-500">Possible support begins at {SUPPORT_THRESHOLDS.possible}; recommended support begins at {SUPPORT_THRESHOLDS.recommended}. There is no hard score cap. Evidence decays over time and repeated events add progressively less.</p>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                  {concepts.length === 0 && <p className="py-4 text-sm text-slate-500">No recent signals suggest additional support.</p>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

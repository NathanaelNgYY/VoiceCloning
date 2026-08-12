import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpenText,
  Flag,
  Layers,
  MessageSquareText,
  RotateCcw,
  Users,
} from 'lucide-react';

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

// One place for the shared control shapes, so a button in the header, the
// evidence list and the timeline cannot quietly drift apart.
// Shapes taken from the GI design file's palette tile: white cards on the
// #EFEFEF ground, a hairline rather than a drawn border, and pill controls that
// carry the brand colour in their text and outline instead of a grey chrome.
const CARD = 'rounded-2xl border border-black/5 bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)]';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2';
const BTN_BASE = `inline-flex cursor-pointer items-center justify-center gap-2 rounded-full text-sm font-semibold transition ${FOCUS}`;
const BTN_OUTLINE = `${BTN_BASE} border border-primary/20 bg-white px-4 py-2 text-primary hover:bg-primary-soft active:scale-[0.98]`;
const BTN_OUTLINE_SM = `${BTN_BASE} border border-primary/20 bg-white px-3 py-1.5 text-xs text-primary hover:bg-primary-soft active:scale-[0.98]`;
const BTN_GHOST_SM = `${BTN_BASE} px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 active:scale-[0.98]`;
const BTN_DANGER_SM = `${BTN_BASE} border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700 shadow-sm hover:border-rose-300 hover:bg-rose-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60`;
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-primary';

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString();
}

function AdminSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-label="Loading admin analytics">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((key) => <div key={key} className="h-28 rounded-2xl bg-black/[0.06]" />)}
      </div>
      <div className="h-96 rounded-2xl bg-black/[0.06]" />
      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="h-72 rounded-2xl bg-black/[0.06]" />
        <div className="h-72 rounded-2xl bg-black/[0.06]" />
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, value, label, tone = 'neutral' }) {
  const toneClass = tone === 'recommended'
    ? 'bg-chart-recommended/10 text-chart-recommended'
    : tone === 'possible'
      ? 'bg-chart-possible/10 text-chart-possible'
      : 'bg-primary-soft text-primary';
  return (
    <div className={`${CARD} flex items-center gap-4 p-5`}>
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${toneClass}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <span className="block font-mono text-3xl font-semibold leading-none tracking-tight text-slate-900">{value}</span>
        <span className="mt-1.5 block text-xs leading-4 text-slate-500">{label}</span>
      </div>
    </div>
  );
}

function ConceptRanking({ cohort }) {
  const [filter, setFilter] = useState('all');
  const [graphReady, setGraphReady] = useState(false);
  const concepts = useMemo(() => {
    const values = [...(cohort?.concepts || [])];
    if (filter === 'recommended') return values.filter((item) => item.supportRecommendedLearners > 0);
    if (filter === 'possible') return values.filter((item) => item.possibleSupportLearners > 0);
    return values;
  }, [cohort, filter]);
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
    <section className={`${CARD} overflow-hidden`} aria-labelledby="cohort-heading">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-black/5 px-6 py-5 sm:px-8">
        <div>
          <p className={SECTION_LABEL}>Cohort overview</p>
          <h2 id="cohort-heading" className="mt-1.5 text-xl font-bold tracking-tight text-slate-900">
            Where learners may benefit from support
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500">
            Behavioural signals are prompts for review, not grades or proof that a learner is struggling.
          </p>
        </div>
        <div className="flex rounded-full bg-black/[0.05] p-1" aria-label="Filter concept ranking">
          {[
            ['all', 'All'],
            ['recommended', 'Recommended'],
            ['possible', 'Possible'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${FOCUS} ${filter === value ? 'bg-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 sm:p-8">
        {concepts.length > 0 ? (
          <>
            <div role="img" aria-label="Grouped vertical bar chart of learner support states by concept">
              {/* The horizontal scroll here also clips vertically, so the hover
                  card has to fit inside the box: pt-28 reserves its height
                  above the plot instead of letting it overflow and vanish. */}
              <div className="overflow-x-auto rounded-2xl border border-black/5 bg-canvas p-4 pt-28 sm:p-6 sm:pt-28">
                <div className="grid min-w-[680px] grid-cols-[2rem_1fr] gap-3">
                  <div className="flex h-52 flex-col justify-between pb-7 text-right font-mono text-[10px] text-slate-400">
                    <span>{maxCount}</span>
                    <span>{Math.round((maxCount / 2) * 10) / 10}</span>
                    <span>0</span>
                  </div>
                  <div>
                    <div className="relative h-44 border-b border-slate-300 bg-[linear-gradient(to_bottom,transparent_49.5%,rgb(226_232_240)_50%,transparent_50.5%)]">
                      <div className="absolute inset-0 flex items-end justify-around gap-3 px-2">
                        {concepts.map((concept, index) => {
                          // The card is wider than a bar slot, so the outermost
                          // columns anchor to their own edge; centring them
                          // would push the card past the plot and clip it.
                          const anchor = index === 0
                            ? 'left-0'
                            : index === concepts.length - 1
                              ? 'right-0'
                              : 'left-1/2 -translate-x-1/2';
                          return (
                          // hover:z-30 lifts the hovered column above the
                          // columns after it, which otherwise paint over the card.
                          <div key={concept.conceptId} className="group relative flex h-full min-w-12 flex-1 items-end justify-center gap-0.5 hover:z-30">
                            {/* Hover layer: the axis is numbered, so the concept
                                name and its two counts have to be reachable
                                without hunting down the list below. */}
                            <div className={`pointer-events-none absolute bottom-full ${anchor} z-10 mb-2 w-48 rounded-xl border border-black/5 bg-white p-3 text-left opacity-0 shadow-lg ring-1 ring-slate-900/5 transition-opacity group-hover:opacity-100`}>
                              <p className="text-xs font-semibold leading-4 text-slate-900">{concept.conceptLabel}</p>
                              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-600">
                                <i className="size-2 rounded-full bg-chart-recommended" />
                                Support recommended
                                <b className="ml-auto font-mono text-slate-900">{concept.supportRecommendedLearners}</b>
                              </p>
                              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                                <i className="size-2 rounded-full bg-chart-possible" />
                                Possible support
                                <b className="ml-auto font-mono text-slate-900">{concept.possibleSupportLearners}</b>
                              </p>
                            </div>
                            {[
                              ['recommended', concept.supportRecommendedLearners, 'bg-chart-recommended'],
                              ['possible', concept.possibleSupportLearners, 'bg-chart-possible'],
                            ].map(([kind, count, colour], barIndex) => (
                              <div key={kind} className="flex h-full w-5 flex-col justify-end px-px sm:w-7">
                                {count > 0 && <span className="mb-1 text-center font-mono text-[10px] font-semibold text-slate-600">{count}</span>}
                                <div
                                  className={`h-[calc(100%-1.25rem)] origin-bottom rounded-t-[4px] ${colour} transition-transform duration-700`}
                                  style={{ transform: `scaleY(${graphReady ? count / maxCount : 0})`, transitionDelay: `${index * 55 + barIndex * 80}ms`, transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)' }}
                                />
                              </div>
                            ))}
                          </div>
                          );
                        })}
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
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-chart-recommended" />Support recommended</span>
                <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-chart-possible" />Possible support</span>
              </div>
            </div>

            <div className="mt-7 border-t border-black/5 pt-5">
              <h3 className="text-sm font-semibold text-slate-900">Concept ranking</h3>
              <p className="mt-1 text-xs text-slate-500">Sorted by support recommended, then possible support.</p>
              <ol className="mt-3 grid gap-x-8 sm:grid-cols-2">
                {concepts.map((concept, index) => (
                  <li key={concept.conceptId} className="grid grid-cols-[1.75rem_1fr_auto] items-center gap-2 border-t border-slate-100 py-2.5 text-xs">
                    <span className="font-mono text-[10px] text-slate-400">{String(index + 1).padStart(2, '0')}</span>
                    <span className="font-medium text-slate-700">{concept.conceptLabel}</span>
                    <span className="flex items-center gap-3 whitespace-nowrap font-mono text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-chart-recommended" />{concept.supportRecommendedLearners}</span>
                      <span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-chart-possible" />{concept.possibleSupportLearners}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        ) : (
          <p className="rounded-2xl border border-dashed border-black/10 px-4 py-10 text-center text-sm text-slate-500">No concepts match this filter yet.</p>
        )}
      </div>
    </section>
  );
}

function ShowMoreControls({ visibleCount, total, step, onMore, onLess }) {
  if (total <= step) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500">Showing {Math.min(visibleCount, total)} of {total}</span>
      <div className="flex gap-2">
        {visibleCount > step && <button type="button" onClick={onLess} className={BTN_GHOST_SM}>Show less</button>}
        {visibleCount < total && <button type="button" onClick={onMore} className={BTN_OUTLINE_SM}>Show {step} more</button>}
      </div>
    </div>
  );
}

function EvidenceList({ events, resetKey }) {
  const [visibleCount, setVisibleCount] = useState(5);
  useEffect(() => setVisibleCount(5), [resetKey]);
  return (
    <>
      <ol className="mt-2 divide-y divide-slate-100 rounded-2xl border border-black/5 bg-white px-4">
        {events.slice(0, visibleCount).map((evidence, eventIndex) => (
          <li key={evidence.eventId || `${evidence.signal}-${eventIndex}`} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="text-sm font-medium text-slate-800">{SIGNAL_LABELS[evidence.signal] || evidence.signal.replaceAll('_', ' ')}</span>
              <span className="rounded-full bg-primary-soft px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
                +{Number(evidence.effectiveContribution || 0).toFixed(3)} now
              </span>
              <span className="font-mono text-[10px] text-slate-400">base {Number(evidence.weight || 0).toFixed(1)}</span>
            </div>
            <time className="font-mono text-[11px] text-slate-500">{formatDate(evidence.occurredAt)}</time>
          </li>
        ))}
        {events.length === 0 && <li className="py-3 text-xs text-slate-500">Detailed event timestamps are unavailable for legacy aggregate evidence.</li>}
      </ol>
      <ShowMoreControls
        visibleCount={visibleCount}
        total={events.length}
        step={5}
        onMore={() => setVisibleCount((count) => Math.min(count + 5, events.length))}
        onLess={() => setVisibleCount(5)}
      />
    </>
  );
}

function QuestionsPanel({ loading, error, oid, questions = [] }) {
  const [visibleCount, setVisibleCount] = useState(5);
  useEffect(() => setVisibleCount(5), [oid]);

  if (loading) return <div className="space-y-3 animate-pulse">{[1, 2, 3].map((key) => <div key={key} className="h-20 rounded-2xl bg-slate-200/70" />)}</div>;
  if (error) return <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>;
  if (questions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 px-5 py-10 text-center">
        <MessageSquareText className="mx-auto size-6 text-slate-300" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-slate-700">No stored questions yet</p>
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
      <ol className="divide-y divide-slate-100 rounded-2xl border border-black/5 bg-white px-4">
        {questions.slice(0, visibleCount).map((question) => (
          <li key={question.id} className="py-4">
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{question.questionText}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-400">
              <time>{formatDate(question.occurredAt)}</time>
              <span>conversation history</span>
            </div>
          </li>
        ))}
      </ol>
      <ShowMoreControls
        visibleCount={visibleCount}
        total={questions.length}
        step={5}
        onMore={() => setVisibleCount((count) => Math.min(count + 5, questions.length))}
        onLess={() => setVisibleCount(5)}
      />
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
    return <div className="space-y-3 animate-pulse">{[1, 2, 3].map((key) => <div key={key} className="h-16 rounded-2xl bg-slate-200/70" />)}</div>;
  }
  if (state.error) return <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{state.error}</p>;
  if (state.events.length === 0) {
    return <p className="rounded-2xl border border-dashed border-black/10 p-6 text-sm text-slate-500">No stored lesson actions were found for this learner.</p>;
  }
  return (
    <div className="space-y-6">
      {state.truncated && (
        <p className="rounded-2xl bg-amber-50 p-3 text-xs text-amber-900">Showing the newest 500 actions. Older stored events were not returned.</p>
      )}
      <section aria-labelledby="event-summary-heading" className="rounded-2xl border border-black/5 bg-canvas p-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4 id="event-summary-heading" className="text-sm font-semibold text-slate-900">Action summary</h4>
            <p className="mt-1 text-xs text-slate-500">Counts from the stored actions returned for this learner.</p>
          </div>
          <p className="font-mono text-2xl font-semibold text-slate-900">{events.length} <span className="text-xs font-normal text-slate-500">total</span></p>
        </div>
        <dl className="mt-4 flex flex-wrap gap-2">
          {actionCounts.map((action) => (
            <div key={action.key} className="flex items-center gap-2 rounded-full border border-black/5 bg-white px-3 py-1.5 shadow-sm">
              <dt className="text-xs text-slate-600">{action.label}</dt>
              <dd className="font-mono text-xs font-semibold text-slate-900">{action.count}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-slate-900">Latest actions</h4>
          <span className="text-xs text-slate-500">Showing {Math.min(visibleCount, events.length)} of {events.length}</span>
        </div>
        <ol className="divide-y divide-slate-100 rounded-2xl border border-black/5 bg-white px-4">
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
          <button type="button" onClick={() => setVisibleCount((count) => Math.min(count + 10, events.length))} className={`${BTN_OUTLINE} mt-4 w-full`}>
            Show 10 more
          </button>
        )}
      </div>
    </div>
  );
}

function ConceptCard({ concept, showEvidence, onReset, resetting, resetKey }) {
  const statusClass = concept.status === 'support_recommended'
    ? 'bg-chart-recommended/10 text-chart-recommended'
    : concept.status === 'possible_support'
      ? 'bg-chart-possible/10 text-chart-possible'
      : 'bg-slate-100 text-slate-600';
  return (
    <div className="py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{concept.conceptLabel}</p>
          <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>
            <i className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {conceptStatusLabel(concept.status)}
          </span>
        </div>
        {concept.status !== 'no_support_inference' && (
          <button type="button" onClick={onReset} disabled={resetting} className={BTN_DANGER_SM}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {resetting ? 'Resetting…' : 'Reset evidence'}
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          [concept.evidenceScore.toFixed(2), `Current score · recommended ≥ ${SUPPORT_THRESHOLDS.recommended}`],
          [concept.evidenceCount, 'Qualifying events'],
          [concept.signals.length, 'Signal types'],
        ].map(([value, label]) => (
          <div key={label} className="rounded-2xl border border-black/5 bg-white p-4">
            <span className="block font-mono text-xl font-semibold leading-none text-slate-900">{value}</span>
            <span className="mt-2 block text-[11px] leading-4 text-slate-500">{label}</span>
          </div>
        ))}
      </div>
      {showEvidence && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Qualifying evidence</p>
          <EvidenceList events={concept.evidenceEvents || []} resetKey={resetKey} />
          <p className="mt-2.5 text-xs leading-5 text-slate-500">
            Possible support begins at {SUPPORT_THRESHOLDS.possible}; recommended support begins at {SUPPORT_THRESHOLDS.recommended}. There is no hard score cap.
            Evidence decays over time and repeated events add progressively less.
          </p>
        </div>
      )}
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

  const recommendedTotal = (cohort?.concepts || []).reduce((sum, concept) => sum + concept.supportRecommendedLearners, 0);
  const possibleTotal = (cohort?.concepts || []).reduce((sum, concept) => sum + concept.possibleSupportLearners, 0);

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
    <div className="relative min-h-[100dvh] bg-canvas text-slate-900">
      {/* The design file puts white cards on a flat #EFEFEF ground with no
          texture behind them, so there is no ambient pattern here. */}
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-4 py-3.5 sm:px-8">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary" aria-hidden="true">
            <BookOpenText className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={SECTION_LABEL}>Admin analytics</p>
            <h1 className="text-base font-bold tracking-tight text-slate-900">Learner support signals</h1>
          </div>
          <button type="button" onClick={() => navigate('/')} className={BTN_OUTLINE}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to lessons
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1400px] px-4 py-7 sm:px-8 sm:py-9">
        <p className="mb-7 max-w-2xl text-sm leading-6 text-slate-500">
          Review cohort patterns, inspect individual evidence, and audit stored lesson actions.
        </p>

        {error && <p className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}

        {loading ? <AdminSkeleton /> : (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Cohort totals">
              <StatTile icon={Users} value={cohort?.totalLearners || 0} label="Identified learners" />
              <StatTile icon={Flag} tone="recommended" value={recommendedTotal} label="Recommended-support states" />
              <StatTile icon={Flag} tone="possible" value={possibleTotal} label="Possible-support states" />
              <StatTile icon={Layers} value={cohort?.concepts?.length || 0} label="Authored concepts" />
            </section>

            {cohort && <ConceptRanking cohort={cohort} />}

            <section className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]" aria-label="Student analytics">
              <aside className={`${CARD} h-fit overflow-hidden`}>
                <div className="border-b border-black/5 px-5 py-4">
                  <h2 className="text-sm font-semibold text-slate-900">Students</h2>
                  <p className="mt-1 text-xs text-slate-500">{users.length} identified learner{users.length === 1 ? '' : 's'}</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {users.map((user) => {
                    const active = selected?.oid === user.oid;
                    return (
                      <button
                        key={user.oid}
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => selectUser(user)}
                        className={`block w-full cursor-pointer border-l-2 px-5 py-4 text-left transition ${FOCUS} ${active ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-slate-50'}`}
                      >
                        <span className={`block text-sm font-semibold ${active ? 'text-primary' : 'text-slate-900'}`}>{user.displayName || 'Unnamed learner'}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{user.email}</span>
                        <span className="mt-2 block font-mono text-[10px] text-slate-400">Last seen {formatDate(user.lastSeenAt)}</span>
                      </button>
                    );
                  })}
                  {users.length === 0 && <p className="p-5 text-sm text-slate-500">No identified learner activity yet.</p>}
                </div>
              </aside>

              <section className={`${CARD} min-h-72 p-5 sm:p-7`}>
                {!selected ? (
                  <div className="flex min-h-60 items-center justify-center text-center">
                    <div>
                      <Users className="mx-auto size-7 text-slate-300" aria-hidden="true" />
                      <p className="mt-3 text-sm font-semibold text-slate-800">Select a student</p>
                      <p className="mt-1 text-sm text-slate-500">Their support summary, signal detail, and stored actions will appear here.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900">{selected.profile?.displayName || 'Learner'}</h2>
                    <p className="mt-1 text-sm text-slate-500">{selected.profile?.email}</p>
                    <div className="mt-5 flex gap-1 overflow-x-auto border-b border-black/5" role="tablist" aria-label="Learner detail">
                      {[
                        ['summary', 'Summary'],
                        ['signals', 'Learning signals'],
                        ['questions', 'Questions'],
                        ['events', 'Events'],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === value}
                          onClick={() => setActiveTab(value)}
                          className={`-mb-px shrink-0 cursor-pointer border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${FOCUS} ${activeTab === value ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-6">
                      {activeTab === 'events' ? <EventTimeline state={eventState} /> : activeTab === 'questions' ? <QuestionsPanel oid={selected.oid} questions={selected.questions || []} /> : (
                        <div className="space-y-5">
                          {(selected.lessons || []).length === 0 && <p className="rounded-2xl border border-dashed border-black/10 p-6 text-sm text-slate-500">No lesson evidence has been recorded for this learner yet.</p>}
                          {(selected.lessons || []).map((lesson) => {
                            const analytics = lessonAnalytics(lesson);
                            const concepts = activeTab === 'signals' ? analytics.concepts : analytics.visibleConcepts;
                            return (
                              <div key={lesson.SK || lesson.lessonSlug} className="rounded-2xl border border-black/5 bg-canvas p-5">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <h3 className="text-sm font-semibold text-slate-900">{lesson.lessonSlug}</h3>
                                    <p className="mt-1 text-xs text-slate-500">Updated {formatDate(lesson.updatedAt)}</p>
                                  </div>
                                  <span className="font-mono text-xs text-slate-500">{analytics.totalEvidence} evidence events</span>
                                </div>
                                {activeTab === 'summary' && (
                                  <p className="mt-4 rounded-2xl border border-primary/15 bg-primary-soft p-4 text-sm leading-6 text-slate-700">{lesson.summary}</p>
                                )}
                                <div className="mt-2 divide-y divide-slate-200">
                                  {concepts.map((concept) => (
                                    <ConceptCard
                                      key={concept.conceptId}
                                      concept={concept}
                                      showEvidence={activeTab === 'signals'}
                                      resetting={resettingConcept === `${lesson.lessonSlug}:${concept.conceptId}`}
                                      onReset={() => resetConcept(lesson.lessonSlug, concept)}
                                      resetKey={`${selected.oid}:${lesson.lessonSlug}:${concept.conceptId}`}
                                    />
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
          </div>
        )}
      </main>
    </div>
  );
}

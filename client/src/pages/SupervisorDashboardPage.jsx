import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { config } from '@/config';
import {
  conceptStatusLabel,
  lessonAnalytics,
  SIGNAL_LABELS,
} from '@/lib/supervisorAnalytics';
import {
  getSupervisorUser,
  listSupervisorUsers,
  resetSupervisorConcept,
} from '@/services/learnerAnalytics';

export function SupervisorDashboardPage() {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [resettingConcept, setResettingConcept] = useState('');

  useEffect(() => {
    let active = true;
    listSupervisorUsers()
      .then((items) => { if (active) setUsers(items); })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError.status === 403
          ? 'Your account does not have supervisor access.'
          : 'The learner dashboard could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

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
    const confirmed = window.confirm(
      `Reset ${concept.conceptLabel} evidence for this learner? This cannot be undone.`,
    );
    if (!confirmed) return;
    const key = `${lessonSlug}:${concept.conceptId}`;
    setResettingConcept(key);
    setError('');
    try {
      await resetSupervisorConcept(selected.oid, lessonSlug, concept.conceptId);
      setSelected({ ...(await getSupervisorUser(selected.oid)), oid: selected.oid });
    } catch {
      setError('The concept evidence could not be reset.');
    } finally {
      setResettingConcept('');
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Supervisor view</p>
          <h1 className="mt-2 text-3xl font-semibold">Learner signals</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Support signals guide optional teaching emphasis; they do not establish uncertainty or mastery.
          </p>
        </header>

        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
        {loading ? <p className="text-sm text-slate-500">Loading learners…</p> : (
          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Students</h2>
              {users.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No identified learner activity yet.</p>
              ) : users.map((user) => (
                <button
                  key={user.oid}
                  type="button"
                  onClick={() => selectUser(user)}
                  className="block w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50"
                >
                  <span className="block text-sm font-medium">{user.displayName || 'Unnamed student'}</span>
                  <span className="block truncate text-xs text-slate-500">{user.email}</span>
                </button>
              ))}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {!selected ? <p className="text-sm text-slate-500">Select a student to review their learning signals.</p> : (
                <>
                  <h2 className="text-xl font-semibold">{selected.profile?.displayName || 'Learner'}</h2>
                  <p className="mt-1 text-sm text-slate-500">{selected.profile?.email}</p>
                  <div className="mt-5 flex gap-1 border-b border-slate-200" role="tablist" aria-label="Learner detail">
                    {[
                      ['summary', 'Summary'],
                      ['signals', 'Learning signals'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === value}
                        onClick={() => setActiveTab(value)}
                        className={`border-b-2 px-3 py-2 text-sm font-medium transition active:translate-y-px ${activeTab === value
                          ? 'border-sky-700 text-sky-800'
                          : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 space-y-3">
                    {(selected.lessons || []).length === 0 && (
                      <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                        No lesson evidence has been recorded for this learner yet.
                      </p>
                    )}
                    {(selected.lessons || []).map((lesson, index) => {
                      const analytics = lessonAnalytics(lesson);
                      return (
                        <details key={lesson.SK} open={index === 0} className="group rounded-xl border border-slate-200 bg-slate-50/70">
                          <summary className="cursor-pointer list-none px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-700">
                            <span className="flex items-center justify-between gap-4">
                              <span>
                                <span className="block text-sm font-semibold">{lesson.lessonSlug}</span>
                                <span className="mt-0.5 block text-xs text-slate-500">
                                  Updated {lesson.updatedAt ? new Date(lesson.updatedAt).toLocaleString() : 'time unavailable'}
                                </span>
                              </span>
                              <span className="text-xs font-medium text-slate-500 group-open:hidden">View</span>
                              <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Hide</span>
                            </span>
                          </summary>

                          <div className="border-t border-slate-200 px-4 py-4">
                            {activeTab === 'summary' ? (
                              <>
                                <p className="text-sm leading-6 text-slate-700">{lesson.summary}</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {analytics.visibleConcepts.map((concept) => (
                                    <span key={concept.conceptId} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900">
                                      {concept.conceptLabel}: {conceptStatusLabel(concept.status).toLowerCase()}
                                    </span>
                                  ))}
                                  {analytics.visibleConcepts.length === 0 && (
                                    <span className="text-xs text-slate-500">No recent signals suggest offering additional support.</span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div>
                                <div className="grid grid-cols-2 divide-x divide-slate-200 border-y border-slate-200 py-3">
                                  <div className="pr-4">
                                    <span className="block text-2xl font-semibold tabular-nums text-slate-900">{analytics.visibleConcepts.length}</span>
                                    <span className="text-xs text-slate-500">Topics with signals</span>
                                  </div>
                                  <div className="pl-4">
                                    <span className="block text-2xl font-semibold tabular-nums text-slate-900">{analytics.totalEvidence}</span>
                                    <span className="text-xs text-slate-500">Qualifying support signals</span>
                                  </div>
                                </div>

                                <div className="mt-5 space-y-5" aria-label="Topics needing review">
                                  {analytics.visibleConcepts.map((concept) => (
                                    <div key={concept.conceptId}>
                                      <div className="mb-1.5 flex items-end justify-between gap-4">
                                        <div>
                                          <p className="text-sm font-medium text-slate-800">{concept.conceptLabel}</p>
                                          <p className="text-xs text-slate-500">{conceptStatusLabel(concept.status)} · {concept.evidenceCount} recent signal{concept.evidenceCount === 1 ? '' : 's'}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => resetConcept(lesson.lessonSlug, concept)}
                                            disabled={resettingConcept === `${lesson.lessonSlug}:${concept.conceptId}`}
                                            className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                                          >
                                            {resettingConcept === `${lesson.lessonSlug}:${concept.conceptId}` ? 'Resetting…' : 'Reset'}
                                          </button>
                                        </div>
                                      </div>
                                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                                        {concept.signals.map((signal) => (
                                          <span key={signal} className="text-xs text-slate-500">{SIGNAL_LABELS[signal] || signal.replaceAll('_', ' ')}</span>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                  {analytics.visibleConcepts.length === 0 && (
                                    <p className="text-sm text-slate-500">No recent signals suggest offering additional support.</p>
                                  )}
                                </div>
                                <p className="mt-5 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500">
                                  These are bounded recent support signals, not grades, diagnoses, or conclusions about understanding.
                                </p>
                              </div>
                            )}
                          </div>
                        </details>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

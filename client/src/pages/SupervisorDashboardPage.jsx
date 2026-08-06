import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { config } from '@/config';
import { getSupervisorUser, listSupervisorUsers } from '@/services/learnerAnalytics';

export function SupervisorDashboardPage() {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
    try {
      setSelected(await getSupervisorUser(user.oid));
    } catch {
      setError('This learner record could not be loaded.');
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Supervisor view</p>
          <h1 className="mt-2 text-3xl font-semibold">Learner signals</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Behaviour signals support teaching decisions; they are not formal assessments.
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
                  <div className="mt-5 space-y-4">
                    {(selected.lessons || []).map((lesson) => (
                      <article key={lesson.SK} className="rounded-xl bg-slate-50 p-4">
                        <h3 className="text-sm font-semibold">{lesson.lessonSlug}</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{lesson.summary}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(lesson.concepts || []).filter((concept) => concept.status !== 'insufficient_evidence').map((concept) => (
                            <span key={concept.conceptId} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-900">
                              {concept.conceptLabel}: {concept.status.replaceAll('_', ' ')}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))}
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

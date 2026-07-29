import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { LessonPage } from '@/pages/LessonPage.jsx';
import { LoginPage } from '@/pages/LoginPage.jsx';
import { SearchPage } from '@/pages/SearchPage.jsx';
import GiChatPage from '@/pages/GiChatPage.jsx';
import { consumeStoredPostLoginPath } from '@/auth/msalClient';
import { useAuth } from '@/auth/useAuth';

function ProtectedRoute({ children }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-500">
        Checking sign-in...
      </div>
    );
  }

  return auth.isAuthenticated ? (
    children
  ) : (
    <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  );
}

function PostLoginRedirectHandler() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      handledRef.current = false;
      return;
    }

    if (auth.isLoading || handledRef.current) {
      return;
    }

    handledRef.current = true;

    const currentPath = `${location.pathname}${location.search}`;
    const storedPath = consumeStoredPostLoginPath();

    if (storedPath && storedPath !== currentPath) {
      navigate(storedPath, { replace: true });
      return;
    }

    if (location.pathname === '/login') {
      navigate('/', { replace: true });
    }
  }, [auth.isAuthenticated, auth.isLoading, location.pathname, location.search, navigate]);

  return null;
}

/**
 * The gi build's route tree: course search, the lesson player, and the
 * standalone voice chat. Ported from gi-bleeding's App.jsx; the admin routes
 * are intentionally absent (that branch drops them too).
 */
export default function GiApp() {
  // The gi palette lives on `.gi-root`. GiChatPage sets it on its own wrapper,
  // but the lesson/search/login pages are separate trees — putting the class on
  // <html> covers every route without wrapping them in an extra layout div.
  useEffect(() => {
    document.documentElement.classList.add('gi-root');
    return () => document.documentElement.classList.remove('gi-root');
  }, []);

  return (
    <>
      <PostLoginRedirectHandler />

      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <SearchPage />
            </ProtectedRoute>
          }
        />
        <Route path="/lesson" element={<Navigate to="/" replace />} />
        <Route
          path="/lesson/:slug"
          element={
            <ProtectedRoute>
              <LessonPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <GiChatPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

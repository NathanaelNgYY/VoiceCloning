import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { LessonPage } from '@/pages/LessonPage.jsx';
import { LoginPage } from '@/pages/LoginPage.jsx';
import { SearchPage } from '@/pages/SearchPage.jsx';
import GiChatPage from '@/pages/GiChatPage.jsx';
import {
  PostLoginRedirectHandler,
  ProtectedRoute,
  SignInRecorder,
} from '@/auth/AppAuthGate';
import { config } from '@/config';

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
      <SignInRecorder />

      <Routes>
        <Route
          path="/login"
          element={
            config.authEnabled ? <LoginPage /> : <Navigate to="/" replace />
          }
        />
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

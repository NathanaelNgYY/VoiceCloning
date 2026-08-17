import { useEffect, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { config } from '@/config';
import { consumeStoredPostLoginPath } from './msalClient';
import { useAuth } from './useAuth';
import { reportSignIn } from '@/services/signInReporter';

export function ProtectedRoute({ children }) {
  if (!config.authEnabled) return children;
  return <AuthenticatedRoute>{children}</AuthenticatedRoute>;
}

function AuthenticatedRoute({ children }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-500">
        Checking sign-in...
      </div>
    );
  }

  return auth.isAuthenticated ? children : (
    <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  );
}

export function SignInRecorder() {
  if (!config.authEnabled) return null;
  return <EnabledSignInRecorder />;
}

function EnabledSignInRecorder() {
  const auth = useAuth();
  const recordedRef = useRef(false);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      recordedRef.current = false;
      return;
    }
    if (auth.isLoading || recordedRef.current) return;

    recordedRef.current = true;
    void reportSignIn();
  }, [auth.isAuthenticated, auth.isLoading]);

  return null;
}

export function PostLoginRedirectHandler() {
  if (!config.authEnabled) return null;
  return <EnabledPostLoginRedirectHandler />;
}

function EnabledPostLoginRedirectHandler() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!auth.isAuthenticated) {
      handledRef.current = false;
      return;
    }
    if (auth.isLoading || handledRef.current) return;

    handledRef.current = true;
    const currentPath = `${location.pathname}${location.search}`;
    const storedPath = consumeStoredPostLoginPath();

    if (storedPath && storedPath !== currentPath) {
      navigate(storedPath, { replace: true });
      return;
    }
    if (location.pathname === '/login') navigate('/', { replace: true });
  }, [auth.isAuthenticated, auth.isLoading, location.pathname, location.search, navigate]);

  return null;
}

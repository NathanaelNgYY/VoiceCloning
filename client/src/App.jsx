import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import TrainingPage from './pages/TrainingPage.jsx';
import InferencePage from './pages/InferencePage.jsx';

export default function App() {
  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col bg-background">
        {/* Header */}
        <header className="sticky top-0 z-50 border-b border-white/60 bg-white/75 backdrop-blur-xl">
          <div className="mx-auto max-w-6xl px-6">
            {/* Title row */}
            <div className="flex items-center justify-between pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-100 text-primary shadow-[0_18px_35px_-24px_rgba(14,165,233,0.85)]">
                  <Activity className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-foreground">
                    Voice Cloning Studio
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    GPT-SoVITS Training & Inference
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <nav className="mt-4 flex w-fit gap-1 rounded-full border border-slate-200/80 bg-white/85 p-1 shadow-sm">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  cn(
                    "inline-block rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-muted-foreground hover:bg-slate-50 hover:text-foreground"
                  )
                }
              >
                Training
              </NavLink>
              <NavLink
                to="/inference"
                className={({ isActive }) =>
                  cn(
                    "inline-block rounded-full px-4 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-muted-foreground hover:bg-slate-50 hover:text-foreground"
                  )
                }
              >
                Inference
              </NavLink>
            </nav>
          </div>
        </header>

        {/* Main content */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
          <Routes>
            <Route path="/" element={<TrainingPage />} />
            <Route path="/inference" element={<InferencePage />} />
          </Routes>
        </main>

        {/* Footer */}
        <footer className="mx-auto w-full max-w-6xl px-6">
          <Separator />
          <div className="flex items-center justify-between py-5">
            <span className="text-xs text-muted-foreground">
              Voice Cloning Studio
            </span>
            <span className="text-xs text-muted-foreground">
              Built with GPT-SoVITS
            </span>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

import { cn } from '@/lib/utils';
import { AvatarOrb } from './AvatarOrb.jsx';

export function AvatarStage({ status, compact = false, fullScreen = false }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden bg-gradient-to-b from-[#eef0fa] to-slate-100 transition-all',
        fullScreen
          ? 'h-full w-full rounded-none border-0 shadow-none'
          : 'w-full rounded-2xl border border-slate-200 shadow-sm',
        compact ? 'aspect-[5/2] sm:aspect-[3/1]' : !fullScreen && 'aspect-[4/3]'
      )}
    >
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <AvatarOrb status={status} />
      </div>
    </div>
  );
}

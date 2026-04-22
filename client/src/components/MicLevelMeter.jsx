import { cn } from '@/lib/utils';

const BAR_COUNT = 16;

export function MicLevelMeter({ level, active }) {
  return (
    <div
      className={cn(
        'flex items-end gap-[3px] h-10 transition-opacity duration-300',
        active ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const t = i / (BAR_COUNT - 1);
        const dome = Math.sin(t * Math.PI);
        const minH = 0.06;
        const barH = minH + (1 - minH) * dome * level;
        return (
          <div
            key={i}
            className="w-1.5 rounded-full bg-sky-400 transition-all duration-75"
            style={{ height: `${barH * 100}%` }}
          />
        );
      })}
    </div>
  );
}

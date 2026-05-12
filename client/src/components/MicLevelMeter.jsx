import { cn } from '@/lib/utils';

const BAR_COUNT = 12;

export function MicLevelMeter({ level, active }) {
  return (
    <div
      className={cn(
        'flex items-end gap-[3px] h-7 transition-all duration-200',
        active ? 'opacity-100' : 'opacity-0 pointer-events-none'
      )}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const t = i / (BAR_COUNT - 1);
        const dome = Math.sin(t * Math.PI);
        const barH = 0.08 + 0.92 * dome * level;
        return (
          <div
            key={i}
            className="w-1 rounded-full bg-primary/70 transition-all duration-75"
            style={{ height: `${barH * 100}%` }}
          />
        );
      })}
    </div>
  );
}

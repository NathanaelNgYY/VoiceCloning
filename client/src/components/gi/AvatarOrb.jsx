import { cn } from '@/lib/utils';
import defaultAvatar from '@/assets/maleavatar.png';

export function AvatarOrb({ status, docked = false }) {
  const ring =
    status === 'speaking' || status === 'listening'
      ? 'animate-pulse-ring-fast'
      : status === 'connecting' || status === 'thinking'
        ? 'animate-pulse-ring'
        : null;

  return (
    <div className={cn('relative', docked ? 'size-10' : 'size-28 sm:size-32')}>
      {ring && (
        <>
          <span className={cn('absolute inset-0 rounded-full bg-primary/35', ring)} />
          <span className={cn('absolute inset-0 rounded-full bg-primary/20 [animation-delay:0.4s]', ring)} />
        </>
      )}
      <div
        className={cn(
          'relative h-full w-full overflow-hidden rounded-full shadow-lg transition-all',
          status === 'error' && 'ring-4 ring-red-400',
          status === 'listening' && 'ring-4 ring-rose-400'
        )}
      >
        <img src={defaultAvatar} alt="Chatbot avatar" className="h-full w-full object-cover" />
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage.jsx';

/**
 * `autoScroll` is off when the surrounding panel owns the scroll viewport and
 * follows it itself (see useStickToBottom) — two followers on one container
 * fight each other, and this one cannot tell whether the reader has scrolled up.
 */
export function ChatList({
  messages,
  status,
  scrollKey = '',
  speakingMessageId = '',
  onPlay,
  autoScroll = true,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!autoScroll) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, status, scrollKey, autoScroll]);

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          message={message}
          speaking={Boolean(speakingMessageId) && speakingMessageId === message.id}
          onPlay={onPlay}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

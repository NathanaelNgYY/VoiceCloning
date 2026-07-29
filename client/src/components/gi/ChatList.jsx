import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage.jsx';

export function ChatList({ messages, status, scrollKey = '', speakingMessageId = '', onPlay }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, status, scrollKey]);

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

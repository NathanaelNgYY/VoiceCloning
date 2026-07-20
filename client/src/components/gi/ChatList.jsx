import { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage.jsx';
import { TypingIndicator } from './TypingIndicator.jsx';

export function ChatList({ messages, status, scrollKey = '' }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, status, scrollKey]);

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {status === 'thinking' && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  );
}

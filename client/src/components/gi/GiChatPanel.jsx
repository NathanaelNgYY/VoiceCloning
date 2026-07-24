import { ChatList } from './ChatList.jsx';
import { Composer } from './Composer.jsx';
import { DisclaimerBanner } from './DisclaimerBanner.jsx';
import { VoiceIndicator } from './VoiceIndicator.jsx';
import { useGiChatEngine } from '@/hooks/useGiChatEngine.js';
import { useGiReplyAudio } from '@/hooks/useGiReplyAudio.js';

const EMPTY_HINT = 'Start a conversation — click the mic';

/**
 * The gi chat surface (messages + notices + voice composer), driven by the
 * cloned-voice engine. Used inside the lesson page's chatbot tab.
 */
export function GiChatPanel({ emptyHint = EMPTY_HINT }) {
  const chat = useGiChatEngine();
  const audioProps = useGiReplyAudio(chat);

  const hasMessages = chat.messages.length > 0;
  const controlsBusy = chat.connecting || chat.responseBusy;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <DisclaimerBanner />

      <div className="min-h-0 flex-1 overflow-y-auto border-b border-slate-100 px-4 py-4">
        {hasMessages ? (
          <ChatList messages={chat.messages} status={chat.status} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <p className="text-xs text-ink-muted">{emptyHint}</p>
          </div>
        )}
      </div>

      {chat.error && (
        <p className="px-4 pt-2 text-center text-xs text-red-600" role="alert">
          {chat.error}
        </p>
      )}

      {!chat.connecting && !chat.voiceReady && !chat.voiceMismatch && (
        <p className="px-4 pt-2 text-center text-xs text-amber-600">
          No cloned voice is set up yet. Activate a voice profile before starting a conversation.
        </p>
      )}

      {chat.notice && <p className="px-4 pt-2 text-center text-xs text-amber-600">{chat.notice}</p>}

      {chat.activeVoiceLabel && (
        <div className="flex flex-wrap items-center justify-center gap-3 px-4 pt-2">
          <VoiceIndicator label={chat.activeVoiceLabel} />
        </div>
      )}

      <div className="px-4 pb-4 pt-2">
        <Composer
          disabled={controlsBusy || !chat.voiceReady}
          loading={chat.connecting}
          active={chat.voiceActive}
          onStart={chat.startConversation}
          onStop={chat.stopConversation}
          micMuted={chat.micMuted}
          onToggleMute={chat.toggleMute}
        />
      </div>

      {/* Cloned-voice playback. Driven imperatively — see useGiReplyAudio. */}
      <audio {...audioProps} />
    </div>
  );
}

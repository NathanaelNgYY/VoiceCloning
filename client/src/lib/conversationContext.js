export const MAX_CONTEXT_MESSAGES = 12;
export const MAX_CONTEXT_MESSAGE_LENGTH = 4000;
export const MAX_CONTEXT_TOTAL_LENGTH = 24000;

export function buildConversationContext(messages, { reservedCharacters = 0 } = {}) {
    const availableCharacters = Math.max(0, MAX_CONTEXT_TOTAL_LENGTH - reservedCharacters);
    const eligibleMessages = messages
        .filter((message) => (message.role === "user" || message.role === "assistant") &&
            !message.pending &&
            !message.failed &&
            typeof message.content === "string" &&
            message.content.trim())
        .map((message) => ({
            role: message.role,
            content: message.content.trim().slice(0, MAX_CONTEXT_MESSAGE_LENGTH),
        }));
    const selected = [];
    let usedCharacters = 0;

    for (let index = eligibleMessages.length - 1; index >= 0; index -= 1) {
        if (selected.length >= MAX_CONTEXT_MESSAGES) {
            break;
        }
        const message = eligibleMessages[index];
        if (usedCharacters + message.content.length > availableCharacters) {
            continue;
        }
        selected.push(message);
        usedCharacters += message.content.length;
    }

    return selected.reverse();
}

/**
 * @typedef {Object} CourseSearchResult
 * @property {string} slug
 * @property {string} title
 * @property {string} description
 * @property {string} matchSummary
 */

/**
 * @typedef {Object} SearchCoursesRequest
 * @property {"search-courses"} action
 * @property {string} query
 */

/**
 * @typedef {Object} SearchCoursesResponse
 * @property {CourseSearchResult[]} results
 */

/**
 * @typedef {Object} CourseTopic
 * @property {number} time
 * @property {string} label
 * @property {number} [thumbnailTime]
 */

/**
 * @typedef {Object} CourseTranscriptSegment
 * @property {number} time
 * @property {number} endTime
 * @property {string} title
 * @property {string} text
 */

/**
 * @typedef {Object} GetCourseRequest
 * @property {"get-course"} action
 * @property {string} slug
 */

/**
 * @typedef {Object} CourseLessonResponse
 * @property {string} slug
 * @property {string} title
 * @property {string} description
 * @property {string} videoUrl
 * @property {CourseTopic[]} topics
 * @property {CourseTranscriptSegment[]} transcriptSegments
 */

/**
 * @typedef {Object} ChatHistoryMessage
 * @property {"user"|"assistant"} role
 * @property {string} content
 */

/**
 * @typedef {Object} ChatRequest
 * @property {"chat"} action
 * @property {string} message Up to 4,000 characters.
 * @property {ChatHistoryMessage[]} history Up to 12 recent completed messages within the 24,000-character request budget.
 */

/**
 * @typedef {Object} ChatResponse
 * @property {string} answer
 */

/**
 * Bootstrap returned by the backend `avatar-session` action (real mode, LiveAvatar LITE).
 * All fields are client-safe: the frontend uses them to join the LiveKit room and,
 * in a later stage, open the control WebSocket to push external ElevenLabs audio.
 *
 * @typedef {Object} AvatarSessionResponse
 * @property {string} avatarSessionId         LiveAvatar session id.
 * @property {string} sessionToken            Client-safe JWT for the control WebSocket.
 * @property {string} livekitUrl              LiveKit server URL to connect to.
 * @property {string} livekitToken            LiveKit client access token (room encoded in token).
 * @property {string|null} controlWebsocketUrl  LITE control WebSocket URL (null until provided).
 * @property {string} avatarId                Configured avatar id (server-owned).
 * @property {string} mode                    LiveAvatar mode (e.g. "lite").
 * @property {number} [maxSessionDurationSeconds]  Max session lifetime in seconds.
 * @property {number} [expiresAt]             Unix epoch seconds when the session expires.
 */

export {};

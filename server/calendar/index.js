// Google Calendar only — invite detection via Gmail/Google Calendar API.
export {
  getInvitedAttendeeEmails,
  calendarStatus,
  calendarConfigured,
  hasInvitedEmail,
  getCalendarAuthUrl,
  completeCalendarOAuth,
  disconnectCalendar,
  hasGoogleCredentials,
} from './google.js';
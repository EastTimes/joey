/** Google Calendar "new event" URL with guest emails pre-filled. */
export function calendarInviteUrl(emails, title = 'Meeting') {
  const guests = (emails || []).filter((e) => e && e.includes('@'));
  if (guests.length === 0) {
    return 'https://calendar.google.com/calendar/u/0/r/eventedit';
  }
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    add: guests.join(','),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
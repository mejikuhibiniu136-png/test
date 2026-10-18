// Kamus sumber (en). Semua bahasa lain bertipe Record<MessageKey, string>: kunci yang hilang = galat kompilasi.
export const en = {
  'nav.main': 'Main navigation', 'nav.overview': 'Overview', 'nav.logs': 'Logs', 'nav.games': 'Game tables', 'nav.accounts': 'Accounts',
  'nav.analytics': 'Analytics', 'nav.users': 'Users', 'nav.sessions': 'Sessions', 'nav.system': 'System', 'nav.logout': 'Sign out',

  'header.greeting': 'Hello, {name}', 'header.live': 'LIVE', 'header.connecting': 'Connecting…', 'header.reconnecting': 'Reconnecting…', 'header.paused': 'Paused',
  'header.logCount': '{count} logs', 'header.logsLoaded': 'Number of logs loaded', 'header.pause': 'Pause', 'header.resume': 'Resume',

  'common.save': 'Save', 'common.cancel': 'Cancel', 'common.close': 'Close', 'common.delete': 'Delete', 'common.retry': 'Retry', 'common.refresh': 'Refresh',
  'common.loading': 'Loading…', 'common.search': 'Search', 'common.clear': 'Clear', 'common.from': 'From', 'common.to': 'To', 'common.enabled': 'Enabled',
  'common.disabled': 'Disabled', 'common.actions': 'Actions', 'common.status': 'Status', 'common.user': 'User', 'common.never': 'Never', 'common.you': 'You',
  'common.error': 'Something went wrong', 'common.confirm': 'Confirm', 'common.loadMore': 'Load more', 'common.test': 'Send test',

  'auth.loginTitle': 'Sign in to dbdataentry', 'auth.registerTitle': 'Create an account', 'auth.loginSubtitle': 'Monitor webhooks and account status in real time.', 'auth.registerSubtitle': 'New accounts wait for Superadmin approval before they can be used.', 'auth.registered': 'Account created. Sign in to see your approval status.', 'auth.username': 'Username', 'auth.password': 'Password', 'auth.confirmPassword': 'Repeat password', 'auth.hidePassword': 'Hide password', 'auth.showPassword': 'Show password', 'auth.minChars': 'At least 8 characters.', 'auth.capsLock': 'Caps Lock is on', 'auth.processing': 'Processing…', 'auth.login': 'Sign in', 'auth.register': 'Sign up', 'auth.noAccount': "Don't have an account? ", 'auth.haveAccount': 'Already have an account? ', 'auth.mismatch': 'Password confirmation does not match', 'auth.errorGeneric': 'Something went wrong', 'auth.errorNetwork': 'A network error occurred',

  'role.superadmin': 'Super Admin', 'role.admin': 'Moderator / Analyst', 'role.viewer': 'User / Client',
  'lang.label': 'Language', 'lang.choose': 'Choose language',

  'sessions.title': 'Sessions & devices', 'sessions.subtitle': 'Active sign-ins, where they come from, and a way to end any of them.',
  'sessions.mine': 'My sessions', 'sessions.all': 'All users', 'sessions.current': 'This device', 'sessions.device': 'Device', 'sessions.location': 'Location',
  'sessions.created': 'Signed in', 'sessions.lastActive': 'Last active', 'sessions.revoke': 'Revoke', 'sessions.revokeOthers': 'Sign out other devices',
  'sessions.revokeUser': 'Revoke all of this user', 'sessions.empty': 'No active sessions.', 'sessions.revokedOne': 'Session revoked',
  'sessions.revokedMany': '{count} sessions revoked', 'sessions.confirmTitle': 'Revoke this session?',
  'sessions.confirmBody': 'The device will be signed out. A revoked session stops working within a few seconds.', 'sessions.confirmAllTitle': 'Revoke all sessions of {name}?',
  'sessions.confirmOthersTitle': 'Sign out all other devices?',

  'notify.title': 'Alert notifications', 'notify.subtitle': 'Send security and system alerts to Discord or Telegram.',
  'notify.platform': 'Destination', 'notify.discord': 'Discord', 'notify.telegram': 'Telegram', 'notify.webhookUrl': 'Discord webhook URL', 'notify.botToken': 'Bot token',
  'notify.chatId': 'Chat ID', 'notify.keepHint': 'Leave blank to keep the saved value', 'notify.enabled': 'Send alerts', 'notify.minSeverity': 'Minimum severity',
  'notify.kinds': 'Alert types', 'notify.allKinds': 'All types', 'notify.save': 'Save channel', 'notify.testSent': 'Test message sent', 'notify.testFailed': 'Test message failed',
  'notify.saved': 'Notification channel saved', 'notify.remove': 'Remove channel', 'notify.history': 'Recent deliveries', 'notify.noHistory': 'Nothing sent yet.',
  'notify.configured': 'Configured', 'notify.notConfigured': 'Not configured', 'notify.encryptionMissing': 'ENCRYPTION_KEY is not set, so credentials cannot be sealed.',
  'notify.sealedNote': 'Credentials are sealed with layered encryption before storage and are never shown again.',
  'notify.severity.info': 'Info', 'notify.severity.warning': 'Warning', 'notify.severity.critical': 'Critical',
  'notify.kind.auth.new_ip': 'Sign-in from a new IP', 'notify.kind.security.spike': 'Security event spike', 'notify.kind.ingest.error_spike': 'Ingest error spike',
  'notify.kind.user.pending_approval': 'Account pending approval', 'notify.kind.queue.backlog': 'Ingest queue backlog', 'notify.kind.queue.dead_letter': 'Ingest dead-letter',
  'notify.kind.crypto.rotation': 'Key rotation problem', 'notify.kind.session.revoked': 'Session revoked by admin', 'notify.kind.system.test': 'Test message',

  'queue.title': 'Ingest queue', 'queue.subtitle': 'Absorbs traffic bursts from game scripts and processes them asynchronously.',
  'queue.mode': 'Queue mode', 'queue.modeHint': 'On: requests are accepted instantly (202) and processed in the background. Off: written directly (default).',
  'queue.depth': 'Waiting', 'queue.inflight': 'Processing', 'queue.dead': 'Dead-letter', 'queue.processed': 'Processed', 'queue.retried': 'Retried', 'queue.rejected': 'Rejected (full)',
  'queue.oldest': 'Oldest item', 'queue.drain': 'Drain now', 'queue.retryDead': 'Retry dead-letter', 'queue.purgeDead': 'Purge dead-letter',

  'logs.searchPlaceholder': 'Search all stored logs…', 'logs.syntax': 'Tip: "exact phrase", -exclude, event:Win, user:alice, game:slug',
  'logs.results': '{count} matches', 'logs.scanned': '{count} logs scanned', 'logs.truncated': 'Only the newest 5,000 logs were searched.',
  'logs.exportCsv': 'Export CSV', 'logs.exportJson': 'Export JSON', 'logs.exportNdjson': 'Export NDJSON', 'logs.serverSearch': 'Server search', 'logs.noMatches': 'No logs match this search.',
  'welcome.title': 'Welcome, {name}', 'welcome.subtitle': 'Your real-time command center for webhooks and account status. Live, secure, and one click away.', 'welcome.enter': 'Enter Dashboard', 'welcome.hint': 'A short guided tour starts on your first visit.',
  'welcome.f1': 'Live stream', 'welcome.f2': 'Account tracking', 'welcome.f3': 'Secure access',
  'tour.replay': 'Tour', 'tour.next': 'Next', 'tour.back': 'Back', 'tour.skip': 'Skip', 'tour.done': 'Finish', 'tour.step': '{current} / {total}',
  'tour.s1.title': 'Welcome aboard', 'tour.s1.body': 'A few quick steps to show you around. You can replay this tour anytime with the Tour button.',
  'tour.s2.title': 'Navigation', 'tour.s2.body': 'Switch between Overview, Logs, Game tables, Accounts and more from here.',
  'tour.s3.title': 'Connection status', 'tour.s3.body': 'LIVE means data is streaming in real time. It turns amber if the connection drops.',
  'tour.s4.title': 'Game tables', 'tour.s4.body': 'Filter everything by game or source. Pick "All" for the combined stream.',
  'tour.s5.title': 'Main content', 'tour.s5.body': 'Stats, charts and logs for the selected page appear here and update automatically.',
  'tour.s6.title': 'Controls', 'tour.s6.body': 'Pause the live stream when you want to inspect data without it moving.',
  // Penjelasan lipat di bawah tabel/panel.
  'sessions.help.title': 'How to read this table',
  'sessions.help.i1': 'Each row is one active login. The row marked "This device" is the session you are using and cannot be revoked.',
  'sessions.help.i2': 'Revoke signs that device out; the session stops working within a few seconds. "Sign out other devices" revokes all your sessions except this one.',
  'sessions.help.i3': 'If your role allows it, the "All users" switch appears so you can view and revoke other users\' sessions.',
  'sessions.help.i4': 'The table refreshes every 15 seconds. "Last active" is when that session was last used.',
  'queue.help.title': 'How the queue works',
  'queue.help.i1': 'When queue mode is on, submissions from game scripts are accepted immediately (202) and written to the log in the background. When off, they are written directly.',
  'queue.help.i2': '"Waiting" items are not processed yet, "In progress" items are being handled, and "Done" items have been written.',
  'queue.help.i3': '"Dead-letter" items kept failing after the maximum number of retries. The number turns red when above 0.',
  'queue.help.i4': '"Retried" counts retry attempts, "Rejected (full)" counts submissions refused because the queue was full, and "Oldest item" is the age of the longest-waiting item. Numbers refresh every 5 seconds.',
  'queue.help.i5': '"Drain now" processes the queue immediately. "Retry dead-letter" puts those items back in the queue; "Clear dead-letter" discards them.',
  'notify.help.title': 'How alerts work',
  'notify.help.i1': 'Choose a destination (Discord or Telegram), fill in its credentials, then save the channel.',
  'notify.help.i2': 'Alert types decide which events are sent; "All types" sends everything.',
  'notify.help.i3': 'Use the test button to send a trial message. Credentials are sealed with layered encryption and are never shown again after saving.',
  'notify.help.i4': '"Recent deliveries" shows up to 8 latest sends: OK or error code, severity (Info, Warning, Critical), title, and time.',
} as const;

export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, string>;

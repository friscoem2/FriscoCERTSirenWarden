const { requireEnv, fetchWholeSheetByTitle } = require('./google-sheets');

function clean(value) {
  return String(value ?? '').trim();
}

function profileEmail(profile) {
  return clean(profile?.EmailAddress || profile?.Email || profile?.['Email Address']).toLowerCase();
}

function profileUsername(profile) {
  return clean(profile?.Username).toLowerCase();
}

function profileAssignmentId(profile) {
  const raw = clean(profile?.['Current Assignment'] || profile?.currentAssignment);
  if (!raw || /^(none|n\/a|unassigned)$/i.test(raw)) return '';
  const match = raw.match(/(?:siren\s*#?\s*)?(\d+)/i);
  return match ? match[1] : '';
}

function parseSheetTimestamp(value) {
  const raw = clean(value);
  if (!raw) return 0;

  // centralTimestamp() writes values such as "9/10/2026, 5:16:36 PM".
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M))?$/i);
  if (match) {
    let hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const meridiem = String(match[7] || '').toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), hour, minute, second);
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateOnly(value) {
  const raw = clean(value);
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };

  match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return { year: Number(match[3]), month: Number(match[1]), day: Number(match[2]) };
  return null;
}

function centralToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function dateOrdinal(parts) {
  if (!parts) return NaN;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function currentWeekBounds() {
  const today = centralToday();
  const todayMs = Date.UTC(today.year, today.month - 1, today.day);
  const weekday = new Date(todayMs).getUTCDay(); // Sunday = 0
  const start = Math.floor(todayMs / 86400000) - weekday;
  return { start, end: start + 6 };
}

function isCurrentWeekDate(value) {
  const ordinal = dateOrdinal(parseDateOnly(value));
  if (!Number.isFinite(ordinal)) return false;
  const { start, end } = currentWeekBounds();
  return ordinal >= start && ordinal <= end;
}

function rowBelongsToUser(row, type, email, username) {
  if (type === 'signup') {
    const rowEmail = clean(row?.[3]).toLowerCase();
    const rowUsername = clean(row?.[4]).toLowerCase();
    return Boolean((email && rowEmail === email) || (username && rowUsername === username));
  }
  const rowEmail = clean(row?.[2]).toLowerCase();
  const rowUsername = clean(row?.[9]).toLowerCase();
  return Boolean((email && rowEmail === email) || (username && rowUsername === username));
}

function sirenIdFromRow(row, type) {
  const direct = clean(type === 'signup' ? row?.[5] : row?.[10]);
  if (direct) return direct;
  const label = clean(type === 'signup' ? row?.[2] : row?.[3]);
  const match = label.match(/(?:siren\s*#?\s*)?(\d+)/i);
  return match ? match[1] : '';
}

function latestActivity(rows, type, email, username) {
  let latest = null;
  for (const row of rows.slice(1)) {
    if (!rowBelongsToUser(row, type, email, username)) continue;
    const at = parseSheetTimestamp(row?.[0]);
    const friendlyName = clean(type === 'signup' ? row?.[6] : row?.[11]);
    if (!latest || at >= latest.at) latest = {
      row,
      at,
      sirenId: sirenIdFromRow(row, type),
      friendlyName,
    };
  }
  return latest;
}

function findActiveAssignment(sirenRows, profile, email) {
  if (email) {
    const row = sirenRows.slice(1).find(candidate => clean(candidate?.[17]).toLowerCase() === email);
    if (row) {
      return {
        id: clean(row[0]),
        friendlyName: clean(row[1] || row[2] || `Siren #${row[0]}`),
      };
    }
  }

  const id = profileAssignmentId(profile);
  if (!id) return null;
  const row = sirenRows.slice(1).find(candidate => clean(candidate?.[0]) === id);
  return {
    id,
    friendlyName: row ? clean(row[1] || row[2] || `Siren #${id}`) : '',
  };
}

async function getAssignmentStatus(profile) {
  const email = profileEmail(profile);
  const username = profileUsername(profile);
  const sirenSheetName = requireEnv('SIREN_SHEET_NAME');
  const signupSheetName = clean(process.env.SIGNUPS_SHEET_NAME || 'Sign Ups');
  const reportSheetName = clean(process.env.SIREN_REPORTS_SHEET_NAME || 'Siren Reports');

  const [sirenRows, signupRows, reportRows] = await Promise.all([
    fetchWholeSheetByTitle(sirenSheetName),
    fetchWholeSheetByTitle(signupSheetName),
    fetchWholeSheetByTitle(reportSheetName),
  ]);

  const activeAssignment = findActiveAssignment(sirenRows, profile, email);
  const latestSignup = latestActivity(signupRows, 'signup', email, username);
  const latestReport = latestActivity(reportRows, 'report', email, username);

  const currentWeekReports = reportRows.slice(1).filter(row =>
    rowBelongsToUser(row, 'report', email, username) && isCurrentWeekDate(row?.[4] || row?.[0])
  );
  const currentWeekReportSubmitted = currentWeekReports.length > 0;
  const currentWeekAssignmentReportSubmitted = Boolean(activeAssignment && currentWeekReports.some(row =>
    sirenIdFromRow(row, 'report') === String(activeAssignment.id)
  ));

  // A report completes the signup that came before it only when it is for that
  // same siren. If the volunteer signs up again afterward, the newer signup
  // becomes the next assignment that needs a report.
  const latestAssignmentCompleted = Boolean(
    latestReport &&
    latestSignup &&
    latestReport.at >= latestSignup.at &&
    (!latestSignup.sirenId || !latestReport.sirenId || latestReport.sirenId === latestSignup.sirenId)
  );

  // Historical/profile-only assignments may not have a matching Sign Ups row.
  // In that case, a current-week report for that active siren completes it.
  const assignmentCompleted = latestAssignmentCompleted || (!latestSignup && currentWeekAssignmentReportSubmitted);
  const assignmentLockRequired = Boolean((activeAssignment || latestSignup?.sirenId) && !assignmentCompleted);

  // Prefer the newest uncompleted Sign Ups row as the assignment to lock onto.
  // This avoids pointing the user back at an older siren while Sheet formulas
  // are still catching up with a just-submitted signup.
  const assignmentNeedingReport = assignmentLockRequired && latestSignup?.sirenId
    ? { id: latestSignup.sirenId, friendlyName: latestSignup.friendlyName || '' }
    : activeAssignment;

  return {
    activeAssignment: assignmentNeedingReport,
    assignmentLockRequired,
    currentWeekReportSubmitted,
    latestSignupAt: latestSignup?.at || 0,
    latestReportAt: latestReport?.at || 0,
  };
}

module.exports = {
  getAssignmentStatus,
  parseSheetTimestamp,
  isCurrentWeekDate,
};

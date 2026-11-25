/**
 * UNIVERSAL Meeting Booking Tracker — compact layout.
 *
 * Columns (row 4 header, data from row 5):
 *   A Name | B Booked Slot | C Reply | D Message | E Join Link | F Status | G EventID (hidden)
 *
 * - BOOKING: synced instantly via a Calendar event trigger (one row per event, keyed by G).
 * - REPLY:   updated every 1 minute via a Gmail poll.
 *
 * Run setup() ONCE to install triggers + authorize. Run cleanupDuplicates() anytime
 * to remove rows that don't belong to the current layout.
 */

// ===== CONFIG =====
var OWNER_EMAIL = "priyanshudeepak2004@gmail.com";
var SHEET_ID = "1RcLja4_12OEP6ObytwFiLzZLmbG9iZww4xG5ABiGh2c";
var SHEET_NAME = "Bookings";
var HEADER_ROW = 4;
var FIRST_DATA_ROW = 5;
var LOOKAHEAD_DAYS = 90;
var REPLY_LOOKBACK = "newer_than:30d";
var MAX_BOOKING_MINUTES = 0; // 0 = no limit; set 15 to only count 15-min slots
// ==================

// Column indexes (1-based)
var C_NAME = 1, C_SLOT = 2, C_REPLY = 3, C_MSG = 4, C_JOIN = 5, C_STATUS = 6, C_EVENTID = 7;
var NCOLS = 7;

function setup() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "pollReplies" || fn === "onCalendarChange") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("onCalendarChange").forUserCalendar(OWNER_EMAIL).onEventUpdated().create();
  ScriptApp.newTrigger("pollReplies").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("updateMeetingStatuses").timeBased().everyMinutes(15).create();

  cleanupDuplicates();   // remove any stray/old-format rows
  syncBookings_();
  pollReplies();
  updateMeetingStatuses();
  Logger.log("Installed. Bookings sync instantly; replies every 1 min; statuses every 15 min.");
}

function getSheet_() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

// Map eventId -> row.
function getEventRowMap_(sheet) {
  var map = {}, last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) return map;
  var ids = sheet.getRange(FIRST_DATA_ROW, C_EVENTID, last - FIRST_DATA_ROW + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    var id = (ids[i][0] || "").toString().trim();
    if (id) map[id] = i + FIRST_DATA_ROW;
  }
  return map;
}

// Remove duplicate rows (same eventId) and rows with no name+eventid.
function cleanupDuplicates() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) return;
  var data = sheet.getRange(FIRST_DATA_ROW, 1, last - FIRST_DATA_ROW + 1, NCOLS).getValues();
  var seen = {}, keep = [];
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var name = (r[C_NAME - 1] || "").toString().trim();
    var id = (r[C_EVENTID - 1] || "").toString().trim();
    if (!name && !id) continue;            // blank row
    var key = id || (name + "|" + r[C_SLOT - 1]);
    if (seen[key]) continue;               // duplicate
    seen[key] = true;
    keep.push(r);
  }
  // clear old area then write deduped rows back
  sheet.getRange(FIRST_DATA_ROW, 1, data.length, NCOLS).clearContent();
  if (keep.length) sheet.getRange(FIRST_DATA_ROW, 1, keep.length, NCOLS).setValues(keep);
}

function onCalendarChange(e) { syncBookings_(); }

function syncBookings_() {
  var sheet = getSheet_();
  var now = new Date();
  var future = new Date(now.getTime() + LOOKAHEAD_DAYS * 864e5);
  var events = CalendarApp.getCalendarById(OWNER_EMAIL).getEvents(now, future);

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.isAllDayEvent()) continue;
    var dur = (ev.getEndTime() - ev.getStartTime()) / 60000;
    if (MAX_BOOKING_MINUTES > 0 && dur > MAX_BOOKING_MINUTES) continue;

    var booker = null, guests = ev.getGuestList();
    for (var g = 0; g < guests.length; g++) {
      var ge = guests[g].getEmail();
      if (ge && ge.toLowerCase() !== OWNER_EMAIL.toLowerCase()) { booker = guests[g]; break; }
    }
    if (!booker) continue;

    var name = booker.getName() || booker.getEmail().split("@")[0];
    var map = getEventRowMap_(sheet);
    var id = ev.getId();
    var row = map[id];
    if (!row) {
      // New booking: insert a fresh row at the TOP (newest first).
      sheet.insertRowBefore(FIRST_DATA_ROW);
      row = FIRST_DATA_ROW;
    }

    sheet.getRange(row, C_NAME).setValue(name);
    sheet.getRange(row, C_SLOT).setValue(fmtSlot_(ev.getStartTime(), ev.getEndTime()));
    if (!sheet.getRange(row, C_REPLY).getValue()) sheet.getRange(row, C_REPLY).setValue("⏳ Awaiting");
    var meet = extractMeetLink_(ev);
    if (meet) sheet.getRange(row, C_JOIN).setValue(meet);
    if (!sheet.getRange(row, C_STATUS).getValue()) sheet.getRange(row, C_STATUS).setValue("🟢 Scheduled");
    sheet.getRange(row, C_EVENTID).setValue(id);
  }
}

// Auto-update meeting Status column based on time + cancellation.
// Leaves your manual choices (Attended / No-show) untouched.
function updateMeetingStatuses() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) return;
  var now = new Date();

  var ids = sheet.getRange(FIRST_DATA_ROW, C_EVENTID, last - FIRST_DATA_ROW + 1, 1).getValues();
  var statuses = sheet.getRange(FIRST_DATA_ROW, C_STATUS, last - FIRST_DATA_ROW + 1, 1).getValues();

  for (var i = 0; i < ids.length; i++) {
    var id = (ids[i][0] || "").toString().trim();
    var status = (statuses[i][0] || "").toString();
    var rowNum = i + FIRST_DATA_ROW;
    if (!id) continue;

    // Don't override a manual decision.
    if (/Attended|No-show|Cancelled|Rescheduled/i.test(status)) continue;

    var ev = null;
    try { ev = CalendarApp.getCalendarById(OWNER_EMAIL).getEventById(id); } catch (e) {}

    if (!ev) {
      // Event no longer exists => cancelled/removed.
      sheet.getRange(rowNum, C_STATUS).setValue("🚫 Cancelled");
      continue;
    }

    // Guest declined => treat as cancelled by them.
    var declined = false;
    try {
      var guests = ev.getGuestList();
      for (var g = 0; g < guests.length; g++) {
        if (guests[g].getGuestStatus && guests[g].getGuestStatus() === CalendarApp.GuestStatus.NO) {
          declined = true; break;
        }
      }
    } catch (e) {}
    if (declined) { sheet.getRange(rowNum, C_STATUS).setValue("🚫 Cancelled"); continue; }

    // Time-based: if the meeting end has passed, ask user to confirm outcome.
    if (ev.getEndTime() < now) {
      sheet.getRange(rowNum, C_STATUS).setValue("⏳ Confirm outcome");
    } else {
      // Still upcoming.
      if (!status || /Confirm outcome/i.test(status)) sheet.getRange(rowNum, C_STATUS).setValue("🟢 Scheduled");
    }
  }
}

function fmtSlot_(s, e) {
  var opts = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true };
  var d = Utilities.formatDate(s, Session.getScriptTimeZone(), "dd MMM");
  var t1 = Utilities.formatDate(s, Session.getScriptTimeZone(), "h:mm");
  var t2 = Utilities.formatDate(e, Session.getScriptTimeZone(), "h:mm a");
  return d + " · " + t1 + "–" + t2;
}

function extractMeetLink_(ev) {
  var hay = (ev.getDescription() || "") + " " + (ev.getLocation() || "");
  var m = hay.match(/https:\/\/meet\.google\.com\/[a-z0-9\-]+/i);
  return m ? m[0] : "";
}

// Poll Gmail for replies from booked people; match by email in their event row.
function pollReplies() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  if (last < FIRST_DATA_ROW) return;
  // We don't store email now, so derive from guest list per event when syncing.
  // Instead, match replies by scanning known booker emails from calendar.
  var now = new Date();
  var past = new Date(now.getTime() - 60 * 864e5);
  var future = new Date(now.getTime() + LOOKAHEAD_DAYS * 864e5);
  var events = CalendarApp.getCalendarById(OWNER_EMAIL).getEvents(past, future);
  var emailByEvent = {};
  for (var i = 0; i < events.length; i++) {
    var guests = events[i].getGuestList();
    for (var g = 0; g < guests.length; g++) {
      var ge = guests[g].getEmail();
      if (ge && ge.toLowerCase() !== OWNER_EMAIL.toLowerCase()) { emailByEvent[events[i].getId()] = ge; break; }
    }
  }
  var map = getEventRowMap_(sheet);
  for (var id in map) {
    var email = emailByEvent[id];
    if (!email) continue;
    var threads = GmailApp.search("from:" + email + " " + REPLY_LOOKBACK, 0, 5);
    var latest = null, ld = 0;
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        if (msgs[m].getFrom().toLowerCase().indexOf(email.toLowerCase()) !== -1) {
          var d = msgs[m].getDate().getTime();
          if (d > ld) { ld = d; latest = msgs[m]; }
        }
      }
    }
    if (latest) {
      sheet.getRange(map[id], C_REPLY).setValue("✅ Replied");
      sheet.getRange(map[id], C_MSG).setValue(cleanReply_(latest.getPlainBody()));
    }
  }
}

function cleanReply_(body) {
  var lines = (body || "").split(/\r?\n/), out = [];
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (/^\s*>/.test(ln)) break;
    if (/^On .+wrote:$/.test(ln.trim())) break;
    if (/^-{2,}\s*Forwarded/.test(ln)) break;
    out.push(ln);
  }
  return out.join(" ").replace(/\s+/g, " ").trim().substring(0, 200);
}

/**
 * OUTREACH AUTOMATION — for the Contacts tab.
 *
 * Runs on a time trigger (every 1 hour) and does two things:
 *   1. REPLY DETECTION: if a contact replied, set status to "↩️ Replied".
 *   2. AUTO FOLLOW-UP: if a contact was emailed >= FOLLOWUP_DAYS ago and hasn't
 *      replied, send ONE follow-up email and mark status "📩 Follow-up sent".
 *
 * Run setupOutreach() ONCE to install the trigger + authorize.
 *
 * Contacts columns: A Name | B Email | C Company | D Role | E Date Emailed | F Status
 * (We use a hidden G "Follow-up Date" to avoid sending twice.)
 */

// ===== CONFIG =====
var SHEET_ID = "1RcLja4_12OEP6ObytwFiLzZLmbG9iZww4xG5ABiGh2c";
var CONTACTS_TAB = "Contacts";
var OWNER_EMAIL = "priyanshudeepak2004@gmail.com";
var FOLLOWUP_DAYS = 3;                // send follow-up if no reply after N days
var BOOKING_LINK = "https://calendar.app.google/VWSPymrNrEKZpDyH7";
var DAILY_SEND_CAP = 40;             // safety: max follow-ups per run
// ==================

// Column indexes (1-based)
var C_NAME = 1, C_EMAIL = 2, C_COMPANY = 3, C_ROLE = 4, C_DATE = 5, C_STATUS = 6, C_FUP = 7;

function setupOutreach() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "runOutreach") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("runOutreach").timeBased().everyHours(1).create();
  runOutreach();
  Logger.log("Outreach automation installed. Runs every hour.");
}

function sheet_() { return SpreadsheetApp.openById(SHEET_ID).getSheetByName(CONTACTS_TAB); }

function runOutreach() {
  var sheet = sheet_();
  var last = sheet.getLastRow();
  if (last < 2) return;

  var rows = sheet.getRange(2, 1, last - 1, 7).getValues();
  var sentCount = 0;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i], rowNum = i + 2;
    var name = (r[C_NAME - 1] || "").toString().trim();
    var email = (r[C_EMAIL - 1] || "").toString().trim();
    var company = (r[C_COMPANY - 1] || "").toString().trim();
    var status = (r[C_STATUS - 1] || "").toString();
    var dateEmailed = r[C_DATE - 1];
    var followupDone = (r[C_FUP - 1] || "").toString().trim();
    if (!email) continue;

    // 1) REPLY DETECTION — did they reply?
    if (!/replied|booked/i.test(status)) {
      var replied = GmailApp.search("from:" + email + " newer_than:30d", 0, 1).length > 0;
      if (replied) {
        sheet.getRange(rowNum, C_STATUS).setValue("↩️ Replied");
        continue; // replied => never follow up
      }
    } else {
      continue; // already replied/booked
    }

    // 2) AUTO FOLLOW-UP — only if emailed long enough ago and not yet followed up
    if (!followupDone && sentCount < DAILY_SEND_CAP) {
      var when = parseDate_(dateEmailed);
      if (when) {
        var daysSince = (new Date() - when) / 864e5;
        if (daysSince >= FOLLOWUP_DAYS) {
          sendFollowup_(name, email, company);
          sheet.getRange(rowNum, C_STATUS).setValue("📩 Follow-up sent");
          sheet.getRange(rowNum, C_FUP).setValue(new Date().toLocaleDateString());
          sentCount++;
        }
      }
    }
  }
}

function sendFollowup_(name, email, company) {
  var greeting = name ? ("Hi " + name + ",") : "Hi,";
  var co = company ? (" at " + company) : "";
  var subject = "Re: quick chat about growth roles" + (company ? " at " + company : "");
  var body = greeting + "\n\n" +
    "Just following up on my note from earlier. I know your calendar's super busy, " +
    "so no pressure at all, but I'd still love to connect about any growth/marketing openings" + co + ".\n\n" +
    "If a quick 15 min works, here's my calendar: " + BOOKING_LINK + "\n\n" +
    "Thanks,\nPriyanshu";
  GmailApp.sendEmail(email, subject, body);
}

function parseDate_(v) {
  if (v instanceof Date) return v;
  var s = (v || "").toString().trim();
  if (!s) return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Tresor's Google side (Safety Simplified Ltd)
 *
 * A small Apps Script web app, set up under Hannah's Google account. Tresor calls it for two jobs:
 *   "email" : email a client their signing link, from Hannah.
 *   "file"  : file a signed policy pack in Google Drive, in a folder named after the client.
 * Only Tresor can use it (shared SECRET). It never returns anything from Drive.
 *
 * Setup: script.google.com > New project > paste this in > set CONFIG > Run "setup" once and accept the permissions >
 * Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone > copy the web app URL.
 * In Railway (tresor > web > Variables) set GOOGLE_RECEIVER_URL to that URL and GOOGLE_RECEIVER_SECRET to the same SECRET as below.
 */

var CONFIG = {
  SECRET: 'CHANGE-ME',                          // any long random phrase; the same value goes in Railway
  NOTIFY_EMAIL: 'hannah@safety-simplified.com', // who is told when a client signs, and where replies go
  SENDER_NAME: 'Hannah, Safety Simplified',     // name the client sees on the email
  PARENT_FOLDER_ID: ''                          // Drive folder for signed packs. Leave empty to create "Signed policy packs" in My Drive.
};

function doGet() { return ContentService.createTextOutput('Tresor Google receiver is running.'); }

function doPost(e) {
  var out;
  try {
    var d = JSON.parse(e.postData.contents);
    if (!CONFIG.SECRET || CONFIG.SECRET === 'CHANGE-ME') out = { ok: false, error: 'Set SECRET in the Google receiver first.' };
    else if (String(d.secret) !== CONFIG.SECRET) out = { ok: false, error: 'Not authorised.' };
    else if (d.action === 'email') out = sendEmail_(d);
    else if (d.action === 'file') out = filePack_(d);
    else out = { ok: false, error: 'Unknown request.' };
  } catch (err) { out = { ok: false, error: 'Google receiver error: ' + err.message }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function sendEmail_(d) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.to || '')) || !d.link || !d.company) return { ok: false, error: 'Email details are missing.' };
  var first = String(d.name || '').split(' ')[0] || 'there';
  var html = '<p>Hi ' + esc_(first) + ',</p>' +
    '<p>Your company policies for <strong>' + esc_(d.company) + '</strong> are ready to sign.</p>' +
    '<p>Please read them and sign using the button below. It takes a few minutes and works on a phone.</p>' +
    '<p><a href="' + esc_(d.link) + '" style="display:inline-block;background:#22734f;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Read and sign your policies</a></p>' +
    '<p>Once you sign, a copy comes straight back to us, so there is nothing to send.</p>' +
    '<p>Thanks,<br>Hannah<br>Safety Simplified Ltd</p>';
  var plain = 'Hi ' + first + ',\n\nYour company policies for ' + d.company + ' are ready to sign.\n\nPlease read them and sign using this link. It takes a few minutes and works on a phone:\n\n' + d.link +
    '\n\nOnce you sign, a copy comes straight back to us, so there is nothing to send.\n\nThanks,\nHannah\nSafety Simplified Ltd';
  MailApp.sendEmail({ to: d.to, subject: d.company + ': policies ready to sign', body: plain, htmlBody: html, name: CONFIG.SENDER_NAME, replyTo: CONFIG.NOTIFY_EMAIL });
  return { ok: true };
}

function filePack_(d) {
  if (!d.pdf || !d.company) return { ok: false, error: 'Nothing to file.' };
  var bytes = Utilities.base64Decode(d.pdf);
  if (!(bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) return { ok: false, error: 'Not a PDF.' }; // "%PDF"
  var folder = clientFolder_(d.company);
  var name = clean_(d.filename || (d.company + ' - Business Policy Pack - signed')).replace(/\.pdf$/i, '') + '.pdf';
  var file = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', name));
  try {
    MailApp.sendEmail({ to: CONFIG.NOTIFY_EMAIL, subject: 'Signed: ' + d.company + ' policy pack',
      body: d.company + ' has signed their policy pack.\n\nSigned by: ' + (d.name || '') + (d.role ? ', ' + d.role : '') + '\nRef: ' + (d.ref || '') + '\nSigned PDF: ' + file.getUrl() + '\nFolder: ' + folder.getUrl() + '\n' });
  } catch (err) {} // the file is saved either way
  return { ok: true, url: file.getUrl(), folder: folder.getUrl() };
}

function parentFolder_() {
  if (CONFIG.PARENT_FOLDER_ID) return DriveApp.getFolderById(CONFIG.PARENT_FOLDER_ID);
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('PARENT_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('Signed policy packs');
  props.setProperty('PARENT_FOLDER_ID', f.getId());
  return f;
}
function clientFolder_(company) {
  var parent = parentFolder_(), name = clean_(company), it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function clean_(s) { return String(s).replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function esc_(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** Run once from the editor to grant permissions and create the Drive folder. */
function setup() {
  Logger.log('Signed packs folder: ' + parentFolder_().getUrl());
  Logger.log('Emails left today: ' + MailApp.getRemainingDailyQuota());
}

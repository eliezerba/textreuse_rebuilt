// Google Apps Script Web App for exposing JSON files from one Google Drive folder.
// Deploy as: Deploy > New deployment > Web app > Anyone.

const FOLDER_ID = '14AWMNFomcpf0r8vd4TSbWurUZ_dsB1QJ';

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'list';
  if (action === 'list') return listFiles_();
  if (action === 'file') return serveFile_(e && e.parameter ? e.parameter.id : '');
  return json_({ ok: false, error: 'Unknown action' });
}

function listFiles_() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const iter = folder.getFiles();
  const files = [];

  while (iter.hasNext()) {
    const file = iter.next();
    const name = file.getName();
    if (!name.toLowerCase().endsWith('.json')) continue;

    files.push({
      id: file.getId(),
      name,
      size: file.getSize(),
      modified: file.getLastUpdated().toISOString(),
      // The app uses this endpoint by default, so no direct Drive CORS issues.
      url: ScriptApp.getService().getUrl() + '?action=file&id=' + encodeURIComponent(file.getId())
    });
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  return json_({ ok: true, files });
}

function serveFile_(fileId) {
  if (!fileId) return json_({ ok: false, error: 'Missing file id' });

  const file = DriveApp.getFileById(fileId);
  const content = file.getBlob().getDataAsString('UTF-8');
  return ContentService
    .createTextOutput(content)
    .setMimeType(ContentService.MimeType.JSON);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const os = require('os');

const PORT = 3344;
const ROOT_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const FACES_PATH = path.join(DATA_DIR, 'faces.json');
const RCLONE_CONF = path.join(DATA_DIR, 'rclone.conf');
const RCLONE_BIN = path.join(BIN_DIR, 'rclone.exe');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Face recognition persistent storage
function loadFacesData() {
  try {
    if (fs.existsSync(FACES_PATH)) {
      return JSON.parse(fs.readFileSync(FACES_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Erro ao ler faces.json:', e.message);
  }
  return { scannedFiles: [], persons: [] };
}

function saveFacesData(data) {
  try {
    fs.writeFileSync(FACES_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Erro ao salvar faces.json:', e.message);
    return false;
  }
}

// State
let sseClients = [];
let activeProcess = null;
let backupState = {
  isRunning: false,
  currentTask: null,
  currentFile: '',
  progressPercent: 0,
  speedFormatted: '0 B/s',
  transferredBytes: 0,
  totalBytes: 0,
  transferredFiles: 0,
  totalFiles: 0,
  baseBytes: 0,
  baseFiles: 0,
  baseTotalBytes: 0,
  baseTotalFiles: 0,
  eta: null,
  logs: []
};

// Config helpers
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (err) {
    console.error('Erro ao ler config.json:', err.message);
  }
  return {
    targetDir: 'E:\\Backup_Fotos',
    backupGoogleDrive: true,
    backupOneDrive: true,
    backupLocalDisks: false,
    localDisksSource: 'F:\\',
    oneDriveMode: 'cloud', // 'cloud' | 'local'
    oneDriveLocalPath: path.join(os.homedir(), 'OneDrive'),
    includePhotos: true,
    includeVideos: true,
    incremental: true,
    subfolderOrganization: 'flat', // 'flat' | 'by_cloud'
    lastBackup: null,
    history: []
  };
}

function saveConfig(newConfig) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Erro ao salvar config.json:', err.message);
    return false;
  }
}

// SSE broadcast
function broadcastSSE(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {
      // client dropped
    }
  });
}

function addLog(msg, level = 'info') {
  const logItem = {
    time: new Date().toLocaleTimeString('pt-PT'),
    level,
    message: msg
  };
  backupState.logs.push(logItem);
  if (backupState.logs.length > 300) backupState.logs.shift();
  broadcastSSE('log', logItem);
}

// Check configured remotes in rclone.conf
function checkConfiguredRemotes() {
  const remotes = {
    gdrive: false,
    onedrive: false
  };

  try {
    if (fs.existsSync(RCLONE_CONF)) {
      const content = fs.readFileSync(RCLONE_CONF, 'utf8');
      if (/\[gdrive\]/i.test(content)) remotes.gdrive = true;
      if (/\[onedrive\]/i.test(content)) remotes.onedrive = true;
    }
  } catch (err) {
    console.error('Erro ao verificar rclone.conf:', err.message);
  }

  return remotes;
}

// Detect available system drives for quick selection
function getSystemDrives() {
  const drives = [];
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  for (const letter of letters) {
    const rootPath = `${letter}:\\`;
    try {
      if (fs.existsSync(rootPath)) {
        let label = `Disco (${letter}:)`;
        if (letter === 'C') label = `Disco Sistema (C:)`;
        else if (letter === 'E') label = `Disco Local (E:)`;
        else if (letter === 'F') label = `Pen Drive / Disco (F:)`;

        drives.push({
          drive: rootPath,
          letter: letter,
          label: label,
          defaultBackupPath: `${letter}:\\Backup_Fotos`
        });
      }
    } catch (e) {}
  }
  return drives;
}

// Build file extensions filter
function getFileExtensions(config) {
  const photos = [
    'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tiff', 'tif',
    'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef'
  ];
  const videos = [
    'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', '3gp', 'wmv', 'flv'
  ];

  let selected = [];
  if (config.includePhotos) selected.push(...photos);
  if (config.includeVideos) selected.push(...videos);

  const allVariants = new Set();
  selected.forEach(ext => {
    allVariants.add(ext.toLowerCase());
    allVariants.add(ext.toUpperCase());
  });

  return Array.from(allVariants);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Clean up any broken .partial files left behind by interrupted downloads
function cleanAbandonedPartials(baseDir) {
  if (!fs.existsSync(baseDir)) return;
  function walk(currentDir) {
    let entries = [];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.partial') || entry.name.includes('.partial.'))) {
        try { fs.unlinkSync(full); } catch (e) {}
      }
    }
  }
  walk(baseDir);
}

// Flatten directory helper: moves all files from subfolders to baseDir, cleans up empty subfolders
function flattenDirectory(baseDir) {
  if (!fs.existsSync(baseDir)) return;

  function walk(currentDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        try {
          const remaining = fs.readdirSync(fullPath);
          if (remaining.length === 0) fs.rmdirSync(fullPath);
        } catch (e) {}
      } else if (entry.isFile()) {
        // NEVER touch in-progress temporary or partial files
        if (entry.name.endsWith('.partial') || entry.name.endsWith('.tmp') || entry.name.includes('.partial.')) {
          continue;
        }

        if (currentDir !== baseDir) {
          let targetName = entry.name.replace(/[<>:"/\\|?*]/g, '_');
          let targetPath = path.join(baseDir, targetName);

          if (fs.existsSync(targetPath)) {
            try {
              const srcStat = fs.statSync(fullPath);
              const destStat = fs.statSync(targetPath);

              if (srcStat.size === destStat.size) {
                try { fs.unlinkSync(fullPath); } catch (e) {}
                continue;
              }

              const ext = path.extname(targetName);
              const base = path.basename(targetName, ext);
              let counter = 1;
              while (fs.existsSync(targetPath)) {
                targetPath = path.join(baseDir, `${base}_${counter}${ext}`);
                counter++;
              }
            } catch (e) {}
          }

          try {
            fs.renameSync(fullPath, targetPath);
          } catch (e) {
            try {
              fs.copyFileSync(fullPath, targetPath);
              fs.unlinkSync(fullPath);
            } catch (err) {}
          }
        }
      }
    }

    if (currentDir !== baseDir) {
      try {
        const remaining = fs.readdirSync(currentDir);
        if (remaining.length === 0) fs.rmdirSync(currentDir);
      } catch (e) {}
    }
  }

  walk(baseDir);

  // Clean up any empty residual folders
  try {
    const remainingDirs = fs.readdirSync(baseDir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const d of remainingDirs) {
      try { fs.rmdirSync(path.join(baseDir, d.name), { recursive: true }); } catch (e) {}
    }
  } catch (e) {}
}

// Detect file year by filename, EXIF metadata, or file modification time
function getFileYear(fullPath, fileName, stat) {
  // 1. Filename pattern YYYYMMDD, YYYY-MM-DD or YYYY_MM_DD
  const dateMatch = fileName.match(/(?:^|[^0-9])(19[89]\d|20[0-3]\d)(?:[01]\d[0-3]\d|[-_][01]\d[-_][0-3]\d)/);
  if (dateMatch) return dateMatch[1];

  // 2. Standalone 4-digit year bounded by non-digits
  const yearMatch = fileName.match(/(?:^|[^0-9])(19[89]\d|20[0-3]\d)(?:[^0-9]|$)/);
  if (yearMatch) return yearMatch[1];

  // 3. EXIF metadata search in first 64KB
  try {
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(Math.min(65536, (stat && stat.size) || 65536));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const str = buf.toString('latin1');
    const exifMatch = str.match(/(19[89]\d|20[0-3]\d):([01]\d):([0-3]\d)\s[0-2]\d:[0-5]\d:[0-5]\d/);
    if (exifMatch) return exifMatch[1];
  } catch (e) {}

  // 4. File modification time (mtime)
  if (stat && stat.mtime) {
    const yr = stat.mtime.getFullYear();
    if (yr >= 1990 && yr <= new Date().getFullYear() + 1) {
      return String(yr);
    }
  }

  // 5. File birthtime (creation time)
  if (stat && stat.birthtime) {
    const yr = stat.birthtime.getFullYear();
    if (yr >= 1990 && yr <= new Date().getFullYear() + 1) {
      return String(yr);
    }
  }

  return 'Outros';
}

// Organize all media files in baseDir into year subfolders (e.g. 2024, 2023, 2022...)
function organizeDirectoryByYear(baseDir) {
  if (!fs.existsSync(baseDir)) return { count: 0, years: [] };

  const allFiles = [];
  function collect(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collect(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.partial') || entry.name.endsWith('.tmp') || entry.name.includes('.partial.')) {
          continue;
        }
        allFiles.push({ fullPath, name: entry.name });
      }
    }
  }
  collect(baseDir);

  let count = 0;
  const yearSet = new Set();

  for (const file of allFiles) {
    try {
      const stat = fs.statSync(file.fullPath);
      const year = getFileYear(file.fullPath, file.name, stat);
      const yearDir = path.join(baseDir, year);

      if (!fs.existsSync(yearDir)) {
        fs.mkdirSync(yearDir, { recursive: true });
      }

      let targetName = file.name.replace(/[<>:"/\\|?*]/g, '_');
      let destPath = path.join(yearDir, targetName);

      if (file.fullPath === destPath) {
        yearSet.add(year);
        continue;
      }

      if (fs.existsSync(destPath)) {
        try {
          const destStat = fs.statSync(destPath);
          if (destStat.size === stat.size) {
            try { fs.unlinkSync(file.fullPath); } catch (e) {}
            yearSet.add(year);
            continue;
          }
          const ext = path.extname(targetName);
          const base = path.basename(targetName, ext);
          let counter = 1;
          while (fs.existsSync(destPath)) {
            destPath = path.join(yearDir, `${base}_${counter}${ext}`);
            counter++;
          }
        } catch (e) {}
      }

      try {
        fs.renameSync(file.fullPath, destPath);
      } catch (e) {
        fs.copyFileSync(file.fullPath, destPath);
        try { fs.unlinkSync(file.fullPath); } catch (err) {}
      }
      count++;
      yearSet.add(year);
    } catch (err) {}
  }

  // Clean empty folders (except year folders)
  try {
    const remainingDirs = fs.readdirSync(baseDir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const d of remainingDirs) {
      const dPath = path.join(baseDir, d.name);
      try {
        if (fs.readdirSync(dPath).length === 0) {
          fs.rmdirSync(dPath);
        }
      } catch (e) {}
    }
  } catch (e) {}

  return { count, years: Array.from(yearSet).sort() };
}

// Media index cache for the calendar and memories
let cachedMediaIndex = null;
let lastCacheTime = 0;
let lastCacheDir = '';

function invalidateMediaCache() {
  cachedMediaIndex = null;
  lastCacheTime = 0;
}

function getMediaIndex(targetDir) {
  const now = Date.now();
  if (cachedMediaIndex && lastCacheDir === targetDir && (now - lastCacheTime < 30000)) {
    return cachedMediaIndex;
  }

  const index = {
    byMonthDay: {}, // 'MM-DD' => [{ year, month, day, name, relPath, size, sizeFormatted, type }]
    monthSummary: {} // 'MM' => { 'DD': count }
  };

  if (!fs.existsSync(targetDir)) return index;

  const imageExts = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif', 'bmp', 'tiff', 'dng', 'cr2', 'nef', 'arw']);
  const videoExts = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', '3gp', 'wmv']);

  function walk(currentDir) {
    let entries = [];
    try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); } catch (e) { return; }
    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.partial') || entry.name.endsWith('.tmp') || entry.name.includes('.partial.')) continue;
        const ext = path.extname(entry.name).toLowerCase().replace('.', '');
        const isImg = imageExts.has(ext);
        const isVid = videoExts.has(ext);
        if (!isImg && !isVid) continue;

        let year = null, month = null, day = null;
        // 1. Filename pattern YYYYMMDD
        const m1 = entry.name.match(/(?:^|[^0-9])(19[89]\d|20[0-3]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
        if (m1) {
          year = parseInt(m1[1]); month = parseInt(m1[2]); day = parseInt(m1[3]);
        } else {
          const m2 = entry.name.match(/(?:^|[^0-9])(19[89]\d|20[0-3]\d)[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
          if (m2) {
            year = parseInt(m2[1]); month = parseInt(m2[2]); day = parseInt(m2[3]);
          }
        }

        let stat = null;
        if (!year) {
          try {
            stat = fs.statSync(full);
            const fd = fs.openSync(full, 'r');
            const buf = Buffer.alloc(Math.min(65536, stat.size));
            fs.readSync(fd, buf, 0, buf.length, 0);
            fs.closeSync(fd);
            const str = buf.toString('latin1');
            const em = str.match(/(19[89]\d|20[0-3]\d):([01]\d):([0-3]\d)\s[0-2]\d:[0-5]\d:[0-5]\d/);
            if (em) {
              year = parseInt(em[1]); month = parseInt(em[2]); day = parseInt(em[3]);
            }
          } catch (e) {}
        }

        if (!year) {
          if (!stat) { try { stat = fs.statSync(full); } catch (e) {} }
          if (stat && stat.mtime) {
            const yr = stat.mtime.getFullYear();
            if (yr >= 1990 && yr <= new Date().getFullYear() + 1) {
              year = yr;
              month = stat.mtime.getMonth() + 1;
              day = stat.mtime.getDate();
            }
          }
        }

        if (year && month && day) {
          const mm = String(month).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          const mdKey = mm + '-' + dd;
          const relPath = path.relative(targetDir, full);

          if (!index.byMonthDay[mdKey]) index.byMonthDay[mdKey] = [];
          index.byMonthDay[mdKey].push({
            name: entry.name,
            relPath: relPath.replace(/\\/g, '/'),
            year: year,
            month: month,
            day: day,
            size: (stat && stat.size) || 0,
            sizeFormatted: formatBytes((stat && stat.size) || 0),
            type: isVid ? 'video' : 'image'
          });

          if (!index.monthSummary[mm]) index.monthSummary[mm] = {};
          index.monthSummary[mm][dd] = (index.monthSummary[mm][dd] || 0) + 1;
        }
      }
    }
  }

  walk(targetDir);
  cachedMediaIndex = index;
  lastCacheTime = now;
  lastCacheDir = targetDir;
  return index;
}

// Face Recognition Helpers
function euclideanDistance(arr1, arr2) {
  let sum = 0;
  for (let i = 0; i < arr1.length; i++) {
    const diff = arr1[i] - arr2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function clusterDetections(newDetections, facesData, threshold = 0.55) {
  if (!facesData.persons) facesData.persons = [];
  if (!facesData.scannedFiles) facesData.scannedFiles = [];

  for (const det of newDetections) {
    if (!facesData.scannedFiles.includes(det.file)) {
      facesData.scannedFiles.push(det.file);
    }

    if (!det.descriptor || det.descriptor.length !== 128) continue;

    let bestPerson = null;
    let minDistance = Infinity;

    for (const person of facesData.persons) {
      if (!person.descriptor) continue;
      const dist = euclideanDistance(det.descriptor, person.descriptor);
      if (dist < minDistance) {
        minDistance = dist;
        bestPerson = person;
      }
    }

    if (bestPerson && minDistance < threshold) {
      if (!bestPerson.files.includes(det.file)) {
        bestPerson.files.push(det.file);
      }
      const n = bestPerson.descriptorsCount || 1;
      for (let i = 0; i < 128; i++) {
        bestPerson.descriptor[i] = (bestPerson.descriptor[i] * n + det.descriptor[i]) / (n + 1);
      }
      bestPerson.descriptorsCount = n + 1;
      // If no avatar or current avatar is empty, set it
      if (!bestPerson.avatar && det.avatar) {
        bestPerson.avatar = det.avatar;
      }
    } else {
      const personId = 'person_' + (Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5));
      const personNumber = facesData.persons.length + 1;
      facesData.persons.push({
        id: personId,
        name: `Pessoa ${personNumber}`,
        avatar: det.avatar || '',
        descriptor: det.descriptor,
        descriptorsCount: 1,
        files: [det.file]
      });
    }
  }

  saveFacesData(facesData);
  return facesData;
}

function organizePhotosByPerson(facesData, targetDir) {
  if (!fs.existsSync(targetDir)) throw new Error('Pasta de destino não encontrada: ' + targetDir);

  const pessoasDir = path.join(targetDir, 'Pessoas');
  if (!fs.existsSync(pessoasDir)) fs.mkdirSync(pessoasDir, { recursive: true });

  let totalCopied = 0;
  for (const person of facesData.persons) {
    if (!person.files || person.files.length === 0) continue;

    const safeName = (person.name || 'Pessoa').replace(/[<>:"/\\|?*]/g, '_').trim();
    const personDir = path.join(pessoasDir, safeName);
    if (!fs.existsSync(personDir)) fs.mkdirSync(personDir, { recursive: true });

    for (const relFile of person.files) {
      const srcPath = path.join(targetDir, relFile);
      if (!fs.existsSync(srcPath)) continue;

      const destPath = path.join(personDir, path.basename(relFile));
      if (!fs.existsSync(destPath)) {
        try {
          fs.copyFileSync(srcPath, destPath);
          totalCopied++;
        } catch (e) {}
      }
    }
  }
  return { success: true, count: totalCopied, personsCount: facesData.persons.length };
}

// Get Google Drive Token and refresh if needed
function getGoogleDriveToken() {
  try {
    if (!fs.existsSync(RCLONE_CONF)) return null;
    let content = fs.readFileSync(RCLONE_CONF, 'utf8');
    let match = content.match(/\[gdrive\][\s\S]*?token\s*=\s*(\{[\s\S]*?\})/);
    if (!match) return null;
    let tokenObj = JSON.parse(match[1]);

    const isExpired = !tokenObj.expiry || new Date(tokenObj.expiry).getTime() - Date.now() < 60000;
    if (isExpired) {
      addLog('A renovar token do Google Drive com o rclone...', 'info');
      try {
        execSync(`"${RCLONE_BIN}" backend token gdrive: --config "${RCLONE_CONF}"`, { stdio: 'ignore' });
      } catch (e) {
        try {
          execSync(`"${RCLONE_BIN}" lsf gdrive: --max-depth 1 --config "${RCLONE_CONF}"`, { stdio: 'ignore' });
        } catch (err) {}
      }
      content = fs.readFileSync(RCLONE_CONF, 'utf8');
      match = content.match(/\[gdrive\][\s\S]*?token\s*=\s*(\{[\s\S]*?\})/);
      if (match) tokenObj = JSON.parse(match[1]);
    }
    return tokenObj.access_token;
  } catch (err) {
    return null;
  }
}

// Query with exponential backoff for Google Drive API
async function fetchGoogleDrivePageWithRetry(url, token, maxRetries = 6) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await new Promise((resolve, reject) => {
        https.get(url, { headers: { Authorization: 'Bearer ' + token } }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            if (r.statusCode === 403 || r.statusCode === 429) {
              reject(new Error(`RATE_LIMIT_${r.statusCode}: ${d.slice(0, 150)}`));
            } else if (r.statusCode !== 200) {
              reject(new Error(`HTTP_${r.statusCode}: ${d.slice(0, 150)}`));
            } else {
              try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
            }
          });
        }).on('error', reject);
      });
      return res;
    } catch (err) {
      if (err.message.includes('RATE_LIMIT') && attempt < maxRetries) {
        const delay = attempt * 2500;
        addLog(`Limite de pedidos Google atingido. A aguardar ${delay / 1000}s para tentar de novo (${attempt}/${maxRetries})...`, 'warning');
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// Query ALL media files across Google Drive (including all subfolders and computers)
async function fetchAllGoogleDriveMedia(token, extensions) {
  addLog('A pesquisar fotos e vídeos em todas as pastas do Google Drive...', 'info');
  let allFiles = [];
  let pageToken = null;

  do {
    let url = 'https://www.googleapis.com/drive/v3/files?pageSize=100&fields=nextPageToken,files(id,name,mimeType,size,trashed)&q=' +
      encodeURIComponent("(mimeType contains 'image/' or mimeType contains 'video/') and trashed = false");
    if (pageToken) url += '&pageToken=' + pageToken;

    const res = await fetchGoogleDrivePageWithRetry(url, token);

    if (res.files) {
      allFiles.push(...res.files);
    }
    pageToken = res.nextPageToken;

    if (pageToken) {
      await new Promise(r => setTimeout(r, 150));
    }
  } while (pageToken && backupState.isRunning);

  const validExts = new Set(extensions.map(e => e.toLowerCase()));
  const filtered = allFiles.filter(f => {
    const ext = path.extname(f.name).toLowerCase().replace('.', '');
    return validExts.has(ext) || f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/');
  });

  addLog(`Encontradas ${filtered.length} fotografias e vídeos em todas as pastas do Google Drive!`, 'success');
  return filtered;
}

// Download Google Drive media directly and save flat
async function downloadGoogleDriveAll(files, destDir, token, isIncremental) {
  let speedInterval = null;
  let bytesLastSec = backupState.transferredBytes;
  let speedBps = 0;

  speedInterval = setInterval(() => {
    const diff = backupState.transferredBytes - bytesLastSec;
    bytesLastSec = backupState.transferredBytes;
    speedBps = Math.max(0, diff);
    backupState.speedFormatted = formatBytes(speedBps) + '/s';
  }, 1000);

  const CONCURRENCY = 4;
  let index = 0;

  async function worker() {
    while (index < files.length && backupState.isRunning) {
      const f = files[index++];
      const fileSize = parseInt(f.size || 0, 10);
      
      let targetName = f.name.replace(/[<>:"/\\|?*]/g, '_');
      let targetPath = path.join(destDir, targetName);

      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.size === fileSize && fileSize > 0) {
          backupState.transferredFiles++;
          backupState.transferredBytes += fileSize;
          updateProgress();
          continue;
        } else if (stat.size !== fileSize) {
          const ext = path.extname(targetName);
          const base = path.basename(targetName, ext);
          let c = 1;
          while (fs.existsSync(targetPath)) {
            targetPath = path.join(destDir, `${base}_${c}${ext}`);
            c++;
          }
        }
      }

      backupState.currentFile = path.basename(targetName);
      updateProgress();

      try {
        await downloadSingleDriveFile(f.id, targetPath, token, fileSize);
        backupState.transferredFiles++;
        addLog(`[Google Drive] Guardado: ${path.basename(targetName)}`, 'info');
      } catch (err) {
        if (!backupState.isRunning) break;
        addLog(`[Google Drive] Falha em ${f.name}: ${err.message}`, 'warning');
      }
      updateProgress();
    }
  }

  function updateProgress() {
    if (backupState.totalBytes > 0) {
      backupState.progressPercent = Math.min(100, Math.round((backupState.transferredBytes / backupState.totalBytes) * 100));
    } else if (backupState.totalFiles > 0) {
      backupState.progressPercent = Math.min(100, Math.round((backupState.transferredFiles / backupState.totalFiles) * 100));
    }

    broadcastSSE('progress', {
      taskName: 'Google Drive',
      percent: backupState.progressPercent,
      transferredBytes: backupState.transferredBytes,
      totalBytes: backupState.totalBytes,
      formattedTransferred: formatBytes(backupState.transferredBytes),
      formattedTotal: formatBytes(backupState.totalBytes),
      speed: backupState.speedFormatted,
      transferredFiles: backupState.transferredFiles,
      totalFiles: backupState.totalFiles,
      currentFile: backupState.currentFile
    });
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  clearInterval(speedInterval);
}

async function downloadSingleDriveFile(fileId, destPath, token, expectedSize, maxRetries = 4) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        const fileStream = fs.createWriteStream(destPath);
        let bytesThisFile = 0;

        const req = https.get(url, { headers: { Authorization: 'Bearer ' + token } }, res => {
          if (res.statusCode !== 200) {
            fileStream.close();
            try { fs.unlinkSync(destPath); } catch (e) {}
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          res.on('data', chunk => {
            bytesThisFile += chunk.length;
            backupState.transferredBytes += chunk.length;
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });

          fileStream.on('error', err => {
            backupState.transferredBytes -= bytesThisFile;
            try { fs.unlinkSync(destPath); } catch (e) {}
            reject(err);
          });
        });

        req.on('error', err => {
          backupState.transferredBytes -= bytesThisFile;
          try { fs.unlinkSync(destPath); } catch (e) {}
          reject(err);
        });
      });
      return;
    } catch (err) {
      if ((err.message.includes('403') || err.message.includes('429')) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, attempt * 2000));
      } else if (attempt === maxRetries) {
        throw err;
      }
    }
  }
}

// Scan and copy all media files from local disks, USB sticks or folders into targetDir
async function syncLocalDiskOrPen(sourceDirsInput, targetDir, config, extensions, stepNum, totalSteps) {
  const sources = (typeof sourceDirsInput === 'string' ? sourceDirsInput.split(/[;,]/) : [sourceDirsInput])
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  if (sources.length === 0) {
    throw new Error('Nenhuma unidade ou pasta de pen drive/disco foi especificada.');
  }

  const validExts = new Set(extensions.map(e => e.toLowerCase()));
  const mediaFiles = [];
  const ignoredFolders = new Set([
    '$recycle.bin', 'system volume information', 'recovery', 'windows', 'appdata',
    'program files', 'program files (x86)', 'node_modules', '.git'
  ]);

  for (const sourceDir of sources) {
    if (!fs.existsSync(sourceDir)) {
      addLog(`Aviso: A unidade ou pasta "${sourceDir}" não está conectada ou não existe. A ignorar...`, 'warning');
      continue;
    }

    if (path.resolve(sourceDir) === path.resolve(targetDir)) {
      addLog(`Aviso: A pasta de origem "${sourceDir}" é a mesma do destino. A ignorar...`, 'warning');
      continue;
    }

    backupState.currentTask = `Pen Drive / Disco (${path.basename(sourceDir) || sourceDir})`;
    broadcastSSE('task_change', { currentTask: backupState.currentTask, step: stepNum, totalSteps });
    addLog(`A pesquisar fotos e vídeos na Pen Drive / Disco (${sourceDir})...`, 'info');

    function scan(dir) {
      if (!backupState.isRunning) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        return;
      }

      for (const entry of entries) {
        if (!backupState.isRunning) break;
        const full = path.join(dir, entry.name);
        const lower = entry.name.toLowerCase();

        if (entry.isDirectory()) {
          if (!ignoredFolders.has(lower) && !entry.name.startsWith('$')) {
            scan(full);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase().replace('.', '');
          if (validExts.has(ext)) {
            try {
              const stat = fs.statSync(full);
              mediaFiles.push({
                fullPath: full,
                name: entry.name,
                size: stat.size
              });
            } catch (e) {}
          }
        }
      }
    }

    scan(sourceDir);
    addLog(`Encontradas ${mediaFiles.length} fotos e vídeos em "${sourceDir}"!`, 'success');
  }

  if (mediaFiles.length === 0) {
    addLog('Nenhuma foto ou vídeo encontrado na(s) pen drive(s) / disco(s) selecionado(s).', 'info');
    return;
  }

  const totalBytes = mediaFiles.reduce((acc, f) => acc + f.size, 0);
  backupState.totalBytes += totalBytes;
  backupState.totalFiles += mediaFiles.length;

  const isFlat = config.subfolderOrganization === 'flat';
  const isByYear = config.subfolderOrganization === 'by_year';
  const destBase = (isFlat || isByYear) ? targetDir : path.join(targetDir, 'Discos_Externos');
  if (!fs.existsSync(destBase)) fs.mkdirSync(destBase, { recursive: true });

  let bytesLastSec = backupState.transferredBytes;
  const speedInterval = setInterval(() => {
    const diff = backupState.transferredBytes - bytesLastSec;
    bytesLastSec = backupState.transferredBytes;
    backupState.speedFormatted = formatBytes(Math.max(0, diff)) + '/s';
  }, 1000);

  function updateProgress() {
    if (backupState.totalBytes > 0) {
      backupState.progressPercent = Math.min(100, Math.round((backupState.transferredBytes / backupState.totalBytes) * 100));
    } else if (backupState.totalFiles > 0) {
      backupState.progressPercent = Math.min(100, Math.round((backupState.transferredFiles / backupState.totalFiles) * 100));
    }

    broadcastSSE('progress', {
      taskName: backupState.currentTask,
      percent: backupState.progressPercent,
      transferredBytes: backupState.transferredBytes,
      totalBytes: backupState.totalBytes,
      formattedTransferred: formatBytes(backupState.transferredBytes),
      formattedTotal: formatBytes(backupState.totalBytes),
      speed: backupState.speedFormatted,
      transferredFiles: backupState.transferredFiles,
      totalFiles: backupState.totalFiles,
      currentFile: backupState.currentFile
    });
  }

  try {
    for (const f of mediaFiles) {
      if (!backupState.isRunning) break;

      let targetName = f.name.replace(/[<>:"/\\|?*]/g, '_');
      let destPath = path.join(destBase, targetName);

      if (fs.existsSync(destPath)) {
        try {
          const destStat = fs.statSync(destPath);
          if (destStat.size === f.size && f.size > 0) {
            backupState.transferredFiles++;
            backupState.transferredBytes += f.size;
            updateProgress();
            continue;
          } else {
            const ext = path.extname(targetName);
            const base = path.basename(targetName, ext);
            let counter = 1;
            while (fs.existsSync(destPath)) {
              destPath = path.join(destBase, `${base}_${counter}${ext}`);
              counter++;
            }
          }
        } catch (e) {}
      }

      backupState.currentFile = path.basename(destPath);
      updateProgress();

      try {
        fs.copyFileSync(f.fullPath, destPath);
        backupState.transferredFiles++;
        backupState.transferredBytes += f.size;
        addLog(`[Pen/Disco] Guardado: ${path.basename(destPath)}`, 'info');
      } catch (err) {
        addLog(`[Pen/Disco] Falha ao copiar ${f.name}: ${err.message}`, 'warning');
      }
      updateProgress();
    }
  } finally {
    clearInterval(speedInterval);
  }
}

// Start backup execution queue
async function startBackup() {
  if (backupState.isRunning) {
    throw new Error('Já existe um processo de cópia de segurança em execução.');
  }

  const config = loadConfig();
  const remotes = checkConfiguredRemotes();
  const targetDir = config.targetDir || 'E:\\Backup_Fotos';
  const isFlat = config.subfolderOrganization === 'flat';
  const isByYear = config.subfolderOrganization === 'by_year';

  // Ensure target folder exists
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const extensions = getFileExtensions(config);

  // Count active tasks
  const tasksToRun = [];
  if (config.backupGoogleDrive) tasksToRun.push('Google Drive');
  if (config.backupOneDrive) tasksToRun.push('Microsoft OneDrive');
  if (config.backupLocalDisks && config.localDisksSource) tasksToRun.push('Pen Drive / Discos');

  if (tasksToRun.length === 0) {
    throw new Error('Nenhuma fonte selecionada. Selecione pelo menos o Google Drive, OneDrive ou uma Pen Drive.');
  }

  // Reset state
  backupState.isRunning = true;
  backupState.progressPercent = 0;
  backupState.transferredBytes = 0;
  backupState.totalBytes = 0;
  backupState.transferredFiles = 0;
  backupState.totalFiles = 0;
  backupState.baseBytes = 0;
  backupState.baseFiles = 0;
  backupState.baseTotalBytes = 0;
  backupState.baseTotalFiles = 0;
  backupState.logs = [];

  addLog('Iniciando syncGallery...', 'info');
  broadcastSSE('status', { isRunning: true });

  // Clean any broken .partial files left behind by previous interrupted transfers
  try {
    cleanAbandonedPartials(targetDir);
  } catch (e) {}

  (async () => {
    let allSuccess = true;
    const startTime = Date.now();
    let currentStep = 0;
    const totalSteps = tasksToRun.length;

    // 1. Process Google Drive (Full-account recursive search)
    if (config.backupGoogleDrive && backupState.isRunning) {
      currentStep++;
      if (!remotes.gdrive) {
        throw new Error('Google Drive não está configurado.');
      }

      backupState.currentTask = 'Google Drive';
      broadcastSSE('task_change', { currentTask: 'Google Drive', step: currentStep, totalSteps });

      const gdriveDest = (isFlat || isByYear) ? targetDir : path.join(targetDir, 'Google_Drive');
      if (!fs.existsSync(gdriveDest)) fs.mkdirSync(gdriveDest, { recursive: true });

      const token = getGoogleDriveToken();
      if (!token) {
        addLog('Erro: Token do Google Drive não encontrado.', 'error');
        allSuccess = false;
      } else {
        try {
          const files = await fetchAllGoogleDriveMedia(token, extensions);
          const gdriveTotalBytes = files.reduce((acc, f) => acc + parseInt(f.size || 0, 10), 0);
          backupState.totalBytes += gdriveTotalBytes;
          backupState.totalFiles += files.length;

          await downloadGoogleDriveAll(files, gdriveDest, token, config.incremental);
          addLog('Google Drive concluído com sucesso!', 'success');
        } catch (err) {
          allSuccess = false;
          addLog(`Erro no Google Drive: ${err.message}`, 'error');
        }
      }
    }

    // 2. Process Microsoft OneDrive
    if (config.backupOneDrive && backupState.isRunning) {
      currentStep++;
      backupState.currentTask = 'Microsoft OneDrive';
      broadcastSSE('task_change', { currentTask: 'Microsoft OneDrive', step: currentStep, totalSteps });

      backupState.baseBytes = backupState.transferredBytes;
      backupState.baseFiles = backupState.transferredFiles;
      backupState.baseTotalBytes = backupState.totalBytes;
      backupState.baseTotalFiles = backupState.totalFiles;

      const onedriveDest = (isFlat || isByYear) ? targetDir : path.join(targetDir, 'OneDrive');
      if (!fs.existsSync(onedriveDest)) fs.mkdirSync(onedriveDest, { recursive: true });

      const source = config.oneDriveMode === 'local'
        ? (config.oneDriveLocalPath || path.join(os.homedir(), 'OneDrive'))
        : 'onedrive:';

      const args = [
        'copy',
        source,
        onedriveDest,
        '--filter', '- /Personal Vault/**',
        '--filter', '- /Personal Vault*',
        '--filter', '- /Cofre Pessoal/**',
        '--filter', '- /Cofre Pessoal*',
        '--filter', `+ **.{${extensions.join(',')}}`,
        '--filter', '- *',
        '--config', RCLONE_CONF,
        '--stats', '1s',
        '--stats-log-level', 'NOTICE',
        '--use-json-log',
        '--checkers', '8',
        '--transfers', '4',
        '--ignore-existing'
      ];

      try {
        await runRcloneProcess(args, 'Microsoft OneDrive');
      } catch (err) {
        allSuccess = false;
        addLog(`Erro no OneDrive: ${err.message}`, 'error');
      }
    }

    // 3. Process Pen Drives & External Disks
    if (config.backupLocalDisks && config.localDisksSource && backupState.isRunning) {
      currentStep++;
      backupState.baseBytes = backupState.transferredBytes;
      backupState.baseFiles = backupState.transferredFiles;
      backupState.baseTotalBytes = backupState.totalBytes;
      backupState.baseTotalFiles = backupState.totalFiles;

      try {
        await syncLocalDiskOrPen(config.localDisksSource, targetDir, config, extensions, currentStep, totalSteps);
        addLog(`Pen Drive / Disco concluído com sucesso!`, 'success');
      } catch (err) {
        allSuccess = false;
        addLog(`Erro ao importar da Pen Drive / Disco: ${err.message}`, 'error');
      }
    }

    // Final organization pass
    if (isFlat) {
      addLog('A garantir que todas as fotos e vídeos estão na pasta principal (sem pastas)...', 'info');
      flattenDirectory(targetDir);
      addLog('Tudo pronto! Todas as fotos e vídeos estão reunidos numa só pasta.', 'success');
    } else if (isByYear) {
      addLog('A organizar fotos e vídeos em pastas por ano...', 'info');
      const result = organizeDirectoryByYear(targetDir);
      addLog(`Organização por anos concluída: ${result.count} ficheiros organizados em ${result.years.length} anos (${result.years.join(', ')}).`, 'success');
    }

    const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
    const summary = {
      success: allSuccess,
      completedAt: new Date().toISOString(),
      durationSeconds: elapsedSeconds,
      filesTransferred: backupState.transferredFiles,
      bytesTransferred: backupState.transferredBytes,
      formattedBytes: formatBytes(backupState.transferredBytes)
    };

    config.lastBackup = summary;
    if (!config.history) config.history = [];
    config.history.unshift(summary);
    if (config.history.length > 20) config.history.pop();
    saveConfig(config);

    backupState.isRunning = false;
    backupState.currentTask = null;
    activeProcess = null;

    addLog(`Sincronização finalizada em ${elapsedSeconds}s!`, allSuccess ? 'success' : 'warning');
    broadcastSSE('completed', summary);
    broadcastSSE('status', { isRunning: false });
  })().catch(err => {
    backupState.isRunning = false;
    activeProcess = null;
    addLog(`Falha geral: ${err.message}`, 'error');
    broadcastSSE('status', { isRunning: false, error: err.message });
  });
}

function runRcloneProcess(args, taskName) {
  return new Promise((resolve, reject) => {
    addLog(`A iniciar cópia do ${taskName}...`, 'info');

    const proc = spawn(RCLONE_BIN, args, { windowsHide: true });
    activeProcess = proc;

    let stderrBuffer = '';

    proc.stdout.on('data', () => {});

    proc.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line.trim());
          if (entry.stats) {
            const stats = entry.stats;
            const taskBytes = stats.bytes || 0;
            const taskTotalBytes = stats.totalBytes || 0;
            const taskTransfers = stats.transfers || 0;
            const taskTotalTransfers = stats.totalTransfers || 0;

            backupState.transferredBytes = (backupState.baseBytes || 0) + taskBytes;
            backupState.totalBytes = (backupState.baseTotalBytes || 0) + taskTotalBytes;
            backupState.transferredFiles = (backupState.baseFiles || 0) + taskTransfers;
            backupState.totalFiles = (backupState.baseTotalFiles || 0) + taskTotalTransfers;

            backupState.speedFormatted = formatBytes(stats.speed || 0) + '/s';
            backupState.eta = stats.eta ? `${Math.ceil(stats.eta)}s` : null;

            if (backupState.totalBytes > 0) {
              backupState.progressPercent = Math.min(100, Math.round((backupState.transferredBytes / backupState.totalBytes) * 100));
            } else if (backupState.totalFiles > 0) {
              backupState.progressPercent = Math.min(100, Math.round((backupState.transferredFiles / backupState.totalFiles) * 100));
            }

            if (stats.transferring && stats.transferring.length > 0) {
              const fullName = stats.transferring[0].name || '';
              backupState.currentFile = path.basename(fullName);
            }

            broadcastSSE('progress', {
              taskName,
              percent: backupState.progressPercent,
              transferredBytes: backupState.transferredBytes,
              totalBytes: backupState.totalBytes,
              formattedTransferred: formatBytes(backupState.transferredBytes),
              formattedTotal: formatBytes(backupState.totalBytes),
              speed: backupState.speedFormatted,
              transferredFiles: backupState.transferredFiles,
              totalFiles: backupState.totalFiles,
              eta: backupState.eta,
              currentFile: backupState.currentFile
            });
          } else if (entry.msg) {
            if (entry.level === 'error') {
              addLog(`[${taskName}] ${entry.msg}`, 'error');
            } else if (entry.msg.includes('Copied')) {
              backupState.transferredFiles++;
              addLog(`[${taskName}] ${entry.msg}`, 'success');
            }
          }
        } catch (e) {
          const raw = line.trim();
          if (raw.length > 0 && !raw.startsWith('{')) {
            addLog(`[${taskName}] ${raw}`, 'info');
          }
        }
      }
    });

    proc.on('close', (code) => {
      activeProcess = null;
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`O processo terminou com código ${code}`));
      }
    });

    proc.on('error', (err) => {
      activeProcess = null;
      reject(err);
    });
  });
}

function stopBackup() {
  if (activeProcess) {
    try {
      exec(`taskkill /pid ${activeProcess.pid} /t /f`);
    } catch (e) {
      activeProcess.kill('SIGKILL');
    }
    activeProcess = null;
  }
  backupState.isRunning = false;
  addLog('Sincronização cancelada pelo utilizador.', 'warning');
  broadcastSSE('status', { isRunning: false, cancelled: true });
}

// HTTP Server
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. SSE Stream
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');
    sseClients.push(res);
    res.write(`event: status\ndata: ${JSON.stringify({ isRunning: backupState.isRunning })}\n\n`);

    req.on('close', () => {
      sseClients = sseClients.filter(c => c !== res);
    });
    return;
  }

  // 2. API Status & Config
  if (pathname === '/api/status' && req.method === 'GET') {
    const config = loadConfig();
    const remotes = checkConfiguredRemotes();
    const drives = getSystemDrives();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      config,
      remotes,
      drives,
      backupState: {
        isRunning: backupState.isRunning,
        currentTask: backupState.currentTask,
        progressPercent: backupState.progressPercent,
        speedFormatted: backupState.speedFormatted,
        transferredBytes: backupState.transferredBytes,
        totalBytes: backupState.totalBytes,
        transferredFiles: backupState.transferredFiles,
        totalFiles: backupState.totalFiles,
        currentFile: backupState.currentFile,
        logs: backupState.logs
      }
    }));
    return;
  }

  // 3. Save Config
  if (pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const updated = JSON.parse(body);
        const current = loadConfig();
        const merged = { ...current, ...updated };
        saveConfig(merged);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, config: merged }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 4. Start Cloud Authentication helper
  if (pathname === '/api/auth/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { provider } = JSON.parse(body);
        if (!['gdrive', 'onedrive'].includes(provider)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Fornecedor inválido' }));
          return;
        }

        const batchFile = path.join(ROOT_DIR, `Conectar-${provider === 'gdrive' ? 'GoogleDrive' : 'OneDrive'}.bat`);
        const cmdContent = provider === 'gdrive'
          ? `@echo off\nchcp 65001 >nul\ntitle Conectar Google Drive\necho ====================================================\necho    A AUTORIZAR GOOGLE DRIVE NO SEU NAVEGADOR...\necho ====================================================\necho O seu navegador ira abrir a pagina de login da Google.\necho Inicie sessao e clique em "Permitir / Continuar".\necho.\n"${RCLONE_BIN}" config create gdrive drive scope drive.readonly --config "${RCLONE_CONF}"\necho.\necho Concluido com sucesso! Pode fechar esta janela.\npause\n`
          : `@echo off\nchcp 65001 >nul\ntitle Conectar Microsoft OneDrive\nnode server\\setup-onedrive.js\necho.\npause\n`;

        fs.writeFileSync(batchFile, cmdContent, 'utf8');
        exec(`start "" "${batchFile}"`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Janela de autorização iniciada. Siga os passos no seu navegador!'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 5. Start Backup
  if (pathname === '/api/backup/start' && req.method === 'POST') {
    startBackup()
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Sincronização iniciada' }));
      })
      .catch((err) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  // 6. Stop Backup
  if (pathname === '/api/backup/stop' && req.method === 'POST') {
    stopBackup();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Cancelamento solicitado' }));
    return;
  }

  // 7. Open Destination Folder in Explorer
  if (pathname === '/api/open-folder' && req.method === 'POST') {
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    if (!fs.existsSync(folder)) {
      try { fs.mkdirSync(folder, { recursive: true }); } catch (e) {}
    }
    exec(`explorer.exe "${folder}"`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // 8. Organize target directory by year
  if (pathname === '/api/organize-by-year' && req.method === 'POST') {
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    if (!fs.existsSync(folder)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Pasta de destino não encontrada: ' + folder }));
      return;
    }

    addLog('A organizar as fotos e vídeos da pasta por ano...', 'info');
    try {
      const result = organizeDirectoryByYear(folder);
      config.subfolderOrganization = 'by_year';
      saveConfig(config);
      addLog(`Fotos organizadas por anos com sucesso! ${result.count} ficheiros distribuídos por ${result.years.length} anos (${result.years.join(', ')}).`, 'success');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: result.count, years: result.years }));
    } catch (err) {
      addLog(`Erro ao organizar por anos: ${err.message}`, 'error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 9. Flatten target directory (undo folders, put all files directly in root)
  if (pathname === '/api/flatten-folder' && req.method === 'POST') {
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    if (!fs.existsSync(folder)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Pasta de destino não encontrada: ' + folder }));
      return;
    }

    addLog('A reunir todas as fotos na raiz da pasta (a remover subpastas)...', 'info');
    try {
      flattenDirectory(folder);
      config.subfolderOrganization = 'flat';
      saveConfig(config);
      invalidateMediaCache();
      addLog('Todas as fotos e vídeos foram reunidos diretamente na pasta principal (sem pastas).', 'success');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      addLog(`Erro ao reunir fotos: ${err.message}`, 'error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 10. Calendar & Memories APIs
  if (pathname === '/api/calendar/month-summary' && req.method === 'GET') {
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    const month = String(parsedUrl.searchParams.get('month') || (new Date().getMonth() + 1)).padStart(2, '0');
    const index = getMediaIndex(folder);
    const summary = (index.monthSummary && index.monthSummary[month]) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ month, days: summary }));
    return;
  }

  if ((pathname === '/api/calendar/day' || pathname === '/api/calendar/today') && req.method === 'GET') {
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    const now = new Date();
    const month = pathname === '/api/calendar/today'
      ? now.getMonth() + 1
      : parseInt(parsedUrl.searchParams.get('month') || (now.getMonth() + 1), 10);
    const day = pathname === '/api/calendar/today'
      ? now.getDate()
      : parseInt(parsedUrl.searchParams.get('day') || now.getDate(), 10);

    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const key = `${mm}-${dd}`;

    const index = getMediaIndex(folder);
    const items = (index.byMonthDay && index.byMonthDay[key]) || [];

    const monthNamesPt = [
      '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    // Group items by year descending
    const groupedYears = {};
    for (const item of items) {
      const yr = String(item.year);
      if (!groupedYears[yr]) groupedYears[yr] = [];
      groupedYears[yr].push(item);
    }

    const sortedYears = Object.keys(groupedYears).sort((a, b) => b - a);
    const resultYears = {};
    sortedYears.forEach(y => { resultYears[y] = groupedYears[y]; });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      month,
      day,
      monthName: monthNamesPt[month] || '',
      dateFormatted: `${day} de ${monthNamesPt[month]}`,
      totalFiles: items.length,
      yearsCount: sortedYears.length,
      years: resultYears
    }));
    return;
  }

  if (pathname === '/api/calendar/refresh' && req.method === 'POST') {
    invalidateMediaCache();
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    getMediaIndex(folder);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Índice de memórias atualizado' }));
    return;
  }

  // 11. Media Stream / Thumbnail Serve
  if (pathname === '/api/media' && req.method === 'GET') {
    const fileParam = parsedUrl.searchParams.get('file');
    if (!fileParam) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Parâmetro file em falta');
      return;
    }

    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    const fullPath = path.resolve(folder, fileParam);

    if (!fullPath.startsWith(path.resolve(folder))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Acesso negado');
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Ficheiro não encontrado');
      return;
    }

    const stat = fs.statSync(fullPath);
    const fileExt = path.extname(fullPath).toLowerCase();
    const mediaMimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.heic': 'image/heic',
      '.bmp': 'image/bmp',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo'
    };

    const contentType = mediaMimeTypes[fileExt] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;
      const stream = fs.createReadStream(fullPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400'
      });
      fs.createReadStream(fullPath).pipe(res);
    }
    return;
  }

  // 12. Open File in Explorer
  if (pathname === '/api/open-in-explorer' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { file } = JSON.parse(body);
        const config = loadConfig();
        const folder = config.targetDir || 'E:\\Backup_Fotos';
        const fullPath = path.resolve(folder, file || '');
        if (fs.existsSync(fullPath)) {
          exec(`explorer.exe /select,"${fullPath}"`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Ficheiro não encontrado' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 13. Face Recognition Endpoints
  if (pathname === '/api/faces/data' && req.method === 'GET') {
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    const facesData = loadFacesData();

    const allImages = [];
    const imageExts = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'bmp']);

    function walk(dir) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Do not scan inside generated Pessoas folder
          if (entry.name.toLowerCase() === 'pessoas') continue;
          walk(full);
        } else if (entry.isFile()) {
          if (entry.name.endsWith('.partial') || entry.name.endsWith('.tmp')) continue;
          const ext = path.extname(entry.name).toLowerCase().replace('.', '');
          if (imageExts.has(ext)) {
            allImages.push(path.relative(folder, full).replace(/\\/g, '/'));
          }
        }
      }
    }
    walk(folder);

    const scannedSet = new Set(facesData.scannedFiles || []);
    const pendingImages = allImages.filter(f => !scannedSet.has(f));

    // Sort persons by number of photos descending
    const persons = (facesData.persons || []).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      photoCount: (p.files && p.files.length) || 0,
      files: p.files || []
    })).sort((a, b) => b.photoCount - a.photoCount);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalImages: allImages.length,
      scannedCount: scannedSet.size,
      pendingCount: pendingImages.length,
      pendingImages: pendingImages,
      persons: persons
    }));
    return;
  }

  if (pathname === '/api/faces/save-batch' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { detections } = JSON.parse(body);
        const facesData = loadFacesData();
        clusterDetections(detections || [], facesData);

        const persons = (facesData.persons || []).map(p => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          photoCount: (p.files && p.files.length) || 0,
          files: p.files || []
        })).sort((a, b) => b.photoCount - a.photoCount);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          scannedCount: (facesData.scannedFiles || []).length,
          persons: persons
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/faces/rename-person' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { personId, name } = JSON.parse(body);
        const facesData = loadFacesData();
        const p = (facesData.persons || []).find(x => x.id === personId);
        if (p) {
          p.name = name.trim();
          saveFacesData(facesData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Pessoa não encontrada' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/faces/merge-persons' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { sourceId, targetId } = JSON.parse(body);
        const facesData = loadFacesData();
        const src = (facesData.persons || []).find(x => x.id === sourceId);
        const tgt = (facesData.persons || []).find(x => x.id === targetId);

        if (src && tgt && src !== tgt) {
          for (const f of src.files) {
            if (!tgt.files.includes(f)) tgt.files.push(f);
          }
          if (src.descriptor && tgt.descriptor) {
            const n1 = tgt.descriptorsCount || 1;
            const n2 = src.descriptorsCount || 1;
            for (let i = 0; i < 128; i++) {
              tgt.descriptor[i] = (tgt.descriptor[i] * n1 + src.descriptor[i] * n2) / (n1 + n2);
            }
            tgt.descriptorsCount = n1 + n2;
          }
          facesData.persons = facesData.persons.filter(x => x.id !== sourceId);
          saveFacesData(facesData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Pessoas inválidas para junção' }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/faces/delete-person' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { personId } = JSON.parse(body);
        const facesData = loadFacesData();
        facesData.persons = (facesData.persons || []).filter(x => x.id !== personId);
        saveFacesData(facesData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/faces/organize-folders' && req.method === 'POST') {
    const config = loadConfig();
    const folder = config.targetDir || 'E:\\Backup_Fotos';
    const facesData = loadFacesData();

    addLog('A organizar fotografias em pastas por pessoa...', 'info');
    try {
      const result = organizePhotosByPerson(facesData, folder);
      addLog(`Organização por pessoas concluída! ${result.count} fotos copiadas para as pastas de ${result.personsCount} pessoas.`, 'success');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: result.count, personsCount: result.personsCount }));
    } catch (e) {
      addLog(`Erro ao organizar por pessoas: ${e.message}`, 'error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/faces/reset' && req.method === 'POST') {
    saveFacesData({ scannedFiles: [], persons: [] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Reconhecimento facial reiniciado' }));
    return;
  }

  // 14. Static file serving from public/
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Ficheiro não encontrado');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Erro interno do servidor');
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n[AVISO] A porta ${PORT} ja esta ocupada por uma sessao anterior.`);
    console.log(`A libertar a porta ${PORT} automaticamente...`);
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        const out = execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, { encoding: 'utf8' });
        const lines = out.trim().split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== String(process.pid)) {
            try {
              execSync(`taskkill /F /PID ${pid}`);
              console.log(`[OK] Sessao anterior terminada (PID: ${pid}).`);
            } catch (_) {}
          }
        }
      }
      setTimeout(() => {
        server.listen(PORT, () => {
          console.log(`=======================================================`);
          console.log(`  📸 syncGallery ativo!`);
          console.log(`  🔗 Aceda no seu navegador: http://localhost:${PORT}`);
          console.log(`=======================================================`);
        });
      }, 1000);
      return;
    } catch (e) {
      console.error(`Nao foi possivel libertar a porta automaticamente: ${e.message}`);
    }
  }
  console.error(`Erro no servidor: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  📸 syncGallery ativo!`);
  console.log(`  🔗 Aceda no seu navegador: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});

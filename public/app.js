// syncGallery Frontend Controller

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const systemStatusBadge = document.getElementById('system-status-badge');
  const systemStatusText = document.getElementById('system-status-text');

  // Clouds
  const checkGDrive = document.getElementById('check-gdrive');
  const gdriveStatusBadge = document.getElementById('gdrive-status-badge');
  const btnAuthGDrive = document.getElementById('btn-auth-gdrive');

  const checkOneDrive = document.getElementById('check-onedrive');
  const onedriveStatusBadge = document.getElementById('onedrive-status-badge');
  const btnAuthOneDrive = document.getElementById('btn-auth-onedrive');
  const onedriveAuthContainer = document.getElementById('onedrive-auth-container');
  const modeOneDriveLocal = document.getElementById('mode-onedrive-local');
  const modeOneDriveCloud = document.getElementById('mode-onedrive-cloud');

  // Pen Drives & External Disks
  const checkLocalDisks = document.getElementById('check-local-disks');
  const diskStatusBadge = document.getElementById('disk-status-badge');
  const diskContainer = document.getElementById('disk-container');
  const inputDiskSource = document.getElementById('input-disk-source');
  const sourceDrivesList = document.getElementById('source-drives-list');
  const btnRefreshDrives = document.getElementById('btn-refresh-drives');

  // Destination & Options
  const inputTargetDir = document.getElementById('input-target-dir');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnOpenFolderSummary = document.getElementById('btn-open-folder-summary');
  const drivesList = document.getElementById('drives-list');

  const checkPhotos = document.getElementById('check-photos');
  const checkVideos = document.getElementById('check-videos');
  const checkIncremental = document.getElementById('check-incremental');
  const orgFlat = document.getElementById('org-flat');
  const orgByYear = document.getElementById('org-by-year');
  const orgByCloud = document.getElementById('org-by-cloud');
  const btnOrganizeYears = document.getElementById('btn-organize-years');
  const btnFlattenNow = document.getElementById('btn-flatten-now');

  // Action & Progress
  const mainStatusHeading = document.getElementById('main-status-heading');
  const mainStatusSubheading = document.getElementById('main-status-subheading');
  const btnStartBackup = document.getElementById('btn-start-backup');
  const btnStopBackup = document.getElementById('btn-stop-backup');

  const progressPanel = document.getElementById('progress-panel');
  const progressBar = document.getElementById('progress-bar');
  const statPercent = document.getElementById('stat-percent');
  const statSpeed = document.getElementById('stat-speed');
  const statFiles = document.getElementById('stat-files');
  const statBytes = document.getElementById('stat-bytes');
  const currentFileName = document.getElementById('current-file-name');

  // Logs
  const logTerminal = document.getElementById('log-terminal');
  const logCountBadge = document.getElementById('log-count-badge');
  const btnToggleLog = document.getElementById('btn-toggle-log');
  let logCount = 0;
  let logVisible = true;

  // History
  const historyDetails = document.getElementById('history-details');

  let currentConfig = {};
  let isRunning = false;
  let sseSource = null;

  // 1. Initial State Fetch
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Falha ao comunicar com o servidor');
      const data = await res.json();
      
      currentConfig = data.config || {};
      applyConfigToUI(currentConfig);
      updateRemotesUI(data.remotes);
      updateDrivesUI(data.drives);
      
      if (data.backupState) {
        if (data.backupState.isRunning) {
          setSyncingState(true);
          updateProgressUI(data.backupState);
        } else {
          setSyncingState(false);
        }
        if (data.backupState.logs && data.backupState.logs.length > 0) {
          renderInitialLogs(data.backupState.logs);
        }
      }

      updateHistoryUI(currentConfig.lastBackup);
    } catch (err) {
      console.error('Erro ao obter estado:', err);
      addLocalLog('Falha ao conectar com o serviço local: ' + err.message, 'error');
    }
  }

  // 2. Apply config to inputs
  function applyConfigToUI(cfg) {
    if (cfg.targetDir) inputTargetDir.value = cfg.targetDir;
    if (typeof cfg.backupGoogleDrive === 'boolean') checkGDrive.checked = cfg.backupGoogleDrive;
    if (typeof cfg.backupOneDrive === 'boolean') checkOneDrive.checked = cfg.backupOneDrive;
    if (typeof cfg.backupLocalDisks === 'boolean') {
      checkLocalDisks.checked = cfg.backupLocalDisks;
      diskContainer.style.display = cfg.backupLocalDisks ? 'flex' : 'none';
      if (diskStatusBadge) {
        diskStatusBadge.className = cfg.backupLocalDisks ? 'tag tag-connected' : 'tag tag-not-connected';
        diskStatusBadge.textContent = cfg.backupLocalDisks ? 'Ativo ✅' : 'Inativo';
      }
    }
    if (cfg.localDisksSource) {
      inputDiskSource.value = cfg.localDisksSource;
    }
    if (typeof cfg.includePhotos === 'boolean') checkPhotos.checked = cfg.includePhotos;
    if (typeof cfg.includeVideos === 'boolean') checkVideos.checked = cfg.includeVideos;
    if (typeof cfg.incremental === 'boolean') checkIncremental.checked = cfg.incremental;
    if (cfg.subfolderOrganization === 'by_year') {
      orgByYear.checked = true;
    } else if (cfg.subfolderOrganization === 'by_cloud') {
      orgByCloud.checked = true;
    } else {
      orgFlat.checked = true;
    }

    if (cfg.oneDriveMode === 'cloud') {
      modeOneDriveCloud.checked = true;
      onedriveAuthContainer.style.display = 'flex';
    } else {
      modeOneDriveLocal.checked = true;
      onedriveAuthContainer.style.display = 'none';
    }
  }

  // 3. Update Remotes status badges
  function updateRemotesUI(remotes) {
    if (!remotes) return;

    if (remotes.gdrive) {
      gdriveStatusBadge.className = 'tag tag-connected';
      gdriveStatusBadge.textContent = 'Conectado ✅';
      btnAuthGDrive.textContent = '🔄 Reconectar Google Drive';
    } else {
      gdriveStatusBadge.className = 'tag tag-not-connected';
      gdriveStatusBadge.textContent = 'Não Conectado';
      btnAuthGDrive.textContent = '🔑 Conectar Google Drive';
    }

    if (remotes.onedrive) {
      onedriveStatusBadge.className = 'tag tag-connected';
      onedriveStatusBadge.textContent = 'Conectado ✅';
      btnAuthOneDrive.textContent = '🔄 Reconectar OneDrive';
    } else {
      onedriveStatusBadge.className = 'tag tag-not-connected';
      onedriveStatusBadge.textContent = 'Não Conectado';
      btnAuthOneDrive.textContent = '🔑 Conectar OneDrive';
    }
  }

  // 4. Update Drives Pills (Destination & Source)
  function updateDrivesUI(drives) {
    if (!drives || drives.length === 0) return;

    // Destino
    drivesList.innerHTML = '';
    drives.forEach(d => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill-btn';
      btn.textContent = `💾 ${d.label} (${d.defaultBackupPath})`;
      btn.addEventListener('click', () => {
        inputTargetDir.value = d.defaultBackupPath;
        saveCurrentConfig();
      });
      drivesList.appendChild(btn);
    });

    // Fonte Pen Drives / Discos
    if (sourceDrivesList) {
      sourceDrivesList.innerHTML = '';
      drives.forEach(d => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill-btn';
        btn.textContent = `🔌 ${d.label} (${d.drive})`;
        btn.addEventListener('click', () => {
          inputDiskSource.value = d.drive;
          saveCurrentConfig();
        });
        sourceDrivesList.appendChild(btn);
      });
    }
  }

  // 5. Update History Card
  function updateHistoryUI(lastBackup) {
    if (!lastBackup) {
      historyDetails.innerHTML = '<p class="empty-history">Ainda não foi realizada nenhuma cópia de segurança nesta sessão.</p>';
      return;
    }

    const dateStr = new Date(lastBackup.completedAt).toLocaleString('pt-PT');
    historyDetails.innerHTML = `
      <div class="history-summary-box">
        <div class="history-stat-group">
          <div class="history-stat">
            <strong>${lastBackup.success ? 'Concluído com Sucesso ✅' : 'Concluído com Alertas ⚠️'}</strong>
            <span>Data: ${dateStr}</span>
          </div>
          <div class="history-stat">
            <strong>${lastBackup.filesTransferred || 0} ficheiros</strong>
            <span>Total guardado: ${lastBackup.formattedBytes || '0 B'}</span>
          </div>
          <div class="history-stat">
            <strong>${lastBackup.durationSeconds || 0} segundos</strong>
            <span>Duração da cópia</span>
          </div>
        </div>
      </div>
    `;
  }

  // 6. Save Config to Backend
  let saveTimeout = null;
  function saveCurrentConfig() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      let subfolderOrg = 'flat';
      if (orgByYear.checked) subfolderOrg = 'by_year';
      else if (orgByCloud.checked) subfolderOrg = 'by_cloud';

      const payload = {
        targetDir: inputTargetDir.value.trim(),
        backupGoogleDrive: checkGDrive.checked,
        backupOneDrive: checkOneDrive.checked,
        backupLocalDisks: checkLocalDisks.checked,
        localDisksSource: inputDiskSource.value.trim(),
        oneDriveMode: modeOneDriveCloud.checked ? 'cloud' : 'local',
        includePhotos: checkPhotos.checked,
        includeVideos: checkVideos.checked,
        incremental: checkIncremental.checked,
        subfolderOrganization: subfolderOrg
      };

      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        console.error('Erro ao guardar configurações:', e);
      }
    }, 400);
  }

  // Event Listeners for configuration
  [checkGDrive, checkOneDrive, checkPhotos, checkVideos, checkIncremental, orgFlat, orgByYear, orgByCloud].forEach(el => {
    el.addEventListener('change', saveCurrentConfig);
  });

  checkLocalDisks.addEventListener('change', () => {
    diskContainer.style.display = checkLocalDisks.checked ? 'flex' : 'none';
    if (diskStatusBadge) {
      diskStatusBadge.className = checkLocalDisks.checked ? 'tag tag-connected' : 'tag tag-not-connected';
      diskStatusBadge.textContent = checkLocalDisks.checked ? 'Ativo ✅' : 'Inativo';
    }
    saveCurrentConfig();
  });

  inputDiskSource.addEventListener('input', saveCurrentConfig);

  if (btnRefreshDrives) {
    btnRefreshDrives.addEventListener('click', async () => {
      addLocalLog('A procurar pen drives e discos conectados...', 'info');
      await fetchStatus();
      addLocalLog('Lista de discos e pen drives atualizada.', 'success');
    });
  }

  inputTargetDir.addEventListener('input', saveCurrentConfig);

  modeOneDriveLocal.addEventListener('change', () => {
    onedriveAuthContainer.style.display = 'none';
    saveCurrentConfig();
  });

  modeOneDriveCloud.addEventListener('change', () => {
    onedriveAuthContainer.style.display = 'flex';
    saveCurrentConfig();
  });

  // Action Buttons: Organize by Year / Flatten
  if (btnOrganizeYears) {
    btnOrganizeYears.addEventListener('click', async () => {
      btnOrganizeYears.disabled = true;
      const originalText = btnOrganizeYears.textContent;
      btnOrganizeYears.textContent = '⏳ A organizar...';
      addLocalLog('A organizar todas as fotos e vídeos por anos...', 'info');

      try {
        const res = await fetch('/api/organize-by-year', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          addLocalLog(`Fotos organizadas por anos com sucesso! ${data.count} ficheiros distribuídos por ${data.years.length} anos (${data.years.join(', ')}).`, 'success');
          orgByYear.checked = true;
        } else {
          addLocalLog('Erro ao organizar por anos: ' + (data.error || 'Falha'), 'error');
        }
      } catch (err) {
        addLocalLog('Falha ao comunicar com o servidor: ' + err.message, 'error');
      } finally {
        btnOrganizeYears.disabled = false;
        btnOrganizeYears.textContent = originalText;
      }
    });
  }

  if (btnFlattenNow) {
    btnFlattenNow.addEventListener('click', async () => {
      btnFlattenNow.disabled = true;
      const originalText = btnFlattenNow.textContent;
      btnFlattenNow.textContent = '⏳ A juntar...';
      addLocalLog('A mover todas as fotos para a raiz da pasta (a eliminar subpastas)...', 'info');

      try {
        const res = await fetch('/api/flatten-folder', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          addLocalLog('Todas as fotos e vídeos foram reunidos diretamente na pasta principal (sem pastas).', 'success');
          orgFlat.checked = true;
        } else {
          addLocalLog('Erro ao juntar fotos: ' + (data.error || 'Falha'), 'error');
        }
      } catch (err) {
        addLocalLog('Falha ao comunicar com o servidor: ' + err.message, 'error');
      } finally {
        btnFlattenNow.disabled = false;
        btnFlattenNow.textContent = originalText;
      }
    });
  }

  // 7. Cloud Auth Buttons
  btnAuthGDrive.addEventListener('click', async () => {
    try {
      addLocalLog('A iniciar processo de autorização do Google Drive...', 'info');
      const res = await fetch('/api/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'gdrive' })
      });
      const data = await res.json();
      if (data.success) {
        addLocalLog('Abra o seu navegador para concluir o login na Google.', 'warning');
      } else {
        addLocalLog(data.error || 'Erro na autorização', 'error');
      }
    } catch (e) {
      addLocalLog('Falha ao comunicar: ' + e.message, 'error');
    }
  });

  btnAuthOneDrive.addEventListener('click', async () => {
    try {
      addLocalLog('A iniciar processo de autorização do Microsoft OneDrive...', 'info');
      const res = await fetch('/api/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'onedrive' })
      });
      const data = await res.json();
      if (data.success) {
        addLocalLog('Abra o seu navegador para concluir o login na Microsoft.', 'warning');
      } else {
        addLocalLog(data.error || 'Erro na autorização', 'error');
      }
    } catch (e) {
      addLocalLog('Falha ao comunicar: ' + e.message, 'error');
    }
  });

  // 8. Open Folder in Explorer
  async function openDestFolder() {
    try {
      await fetch('/api/open-folder', { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
  }
  btnOpenFolder.addEventListener('click', openDestFolder);
  btnOpenFolderSummary.addEventListener('click', openDestFolder);

  // 9. Start / Stop Backup
  btnStartBackup.addEventListener('click', async () => {
    saveCurrentConfig();
    try {
      btnStartBackup.disabled = true;
      const res = await fetch('/api/backup/start', { method: 'POST' });
      const data = await res.json();
      if (!data.success) {
        addLocalLog(data.error || 'Não foi possível iniciar o backup', 'error');
        btnStartBackup.disabled = false;
      }
    } catch (e) {
      addLocalLog('Erro ao iniciar backup: ' + e.message, 'error');
      btnStartBackup.disabled = false;
    }
  });

  btnStopBackup.addEventListener('click', async () => {
    try {
      await fetch('/api/backup/stop', { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
  });

  // 10. UI State changes (Syncing vs Idle)
  function setSyncingState(syncing) {
    isRunning = syncing;
    if (syncing) {
      systemStatusBadge.className = 'badge badge-syncing';
      systemStatusText.textContent = 'A sincronizar fotos...';
      mainStatusHeading.textContent = 'Cópia de segurança em curso';
      mainStatusSubheading.textContent = 'Por favor não feche a aplicação enquanto o processo estiver ativo.';
      btnStartBackup.style.display = 'none';
      btnStopBackup.style.display = 'inline-flex';
      progressPanel.style.display = 'flex';
    } else {
      systemStatusBadge.className = 'badge badge-ready';
      systemStatusText.textContent = 'Pronto a sincronizar';
      mainStatusHeading.textContent = 'Pronto para iniciar';
      mainStatusSubheading.textContent = 'Clique no botão para iniciar a cópia segura das suas fotos.';
      btnStartBackup.style.display = 'inline-flex';
      btnStartBackup.disabled = false;
      btnStopBackup.style.display = 'none';
    }
  }

  function updateProgressUI(data) {
    const pct = data.percent !== undefined ? data.percent : (data.progressPercent || 0);
    progressBar.style.width = `${pct}%`;
    statPercent.textContent = `${pct}%`;
    statSpeed.textContent = data.speed || data.speedFormatted || '0 B/s';
    
    const x = data.transferredFiles || 0;
    const y = data.totalFiles || 0;
    statFiles.textContent = `${x} / ${y}`;

    const b = data.formattedTransferred || '0 B';
    const tb = data.formattedTotal || '0 B';
    statBytes.textContent = `${b} / ${tb}`;

    if (data.currentFile) {
      currentFileName.textContent = data.currentFile;
    }
  }

  // 11. SSE Real-Time Stream
  function connectSSE() {
    if (sseSource) sseSource.close();
    sseSource = new EventSource('/api/events');

    sseSource.addEventListener('status', (e) => {
      const data = JSON.parse(e.data);
      setSyncingState(data.isRunning);
      if (data.error) {
        addLocalLog('Erro: ' + data.error, 'error');
      }
      fetchStatus();
    });

    sseSource.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data);
      updateProgressUI(data);
    });

    sseSource.addEventListener('task_change', (e) => {
      const data = JSON.parse(e.data);
      mainStatusHeading.textContent = `A sincronizar: ${data.currentTask} (${data.step}/${data.totalSteps})`;
    });

    sseSource.addEventListener('log', (e) => {
      const log = JSON.parse(e.data);
      appendLog(log);
    });

    sseSource.addEventListener('completed', (e) => {
      const summary = JSON.parse(e.data);
      updateHistoryUI(summary);
      setSyncingState(false);
      progressBar.style.width = '100%';
      statPercent.textContent = '100%';
      currentFileName.textContent = 'Todas as fotos foram sincronizadas com sucesso!';
    });

    sseSource.onerror = () => {
      // Reconnect automatically
      setTimeout(connectSSE, 3000);
    };
  }

  // 12. Logs Helpers
  function renderInitialLogs(logs) {
    logTerminal.innerHTML = '';
    logs.forEach(l => appendLog(l, false));
    logCount = logs.length;
    logCountBadge.textContent = `${logCount} eventos`;
    logTerminal.scrollTop = logTerminal.scrollHeight;
  }

  function appendLog(log, scroll = true) {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${log.level || 'info'}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${log.time || new Date().toLocaleTimeString('pt-PT')}]`;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'log-msg';
    msgSpan.textContent = log.message;

    entry.appendChild(timeSpan);
    entry.appendChild(msgSpan);
    logTerminal.appendChild(entry);

    logCount++;
    logCountBadge.textContent = `${logCount} eventos`;

    if (scroll) {
      logTerminal.scrollTop = logTerminal.scrollHeight;
    }
  }

  function addLocalLog(message, level = 'info') {
    appendLog({
      time: new Date().toLocaleTimeString('pt-PT'),
      level,
      message
    });
  }

  // Toggle log section
  btnToggleLog.addEventListener('click', () => {
    logVisible = !logVisible;
    logTerminal.style.display = logVisible ? 'flex' : 'none';
    btnToggleLog.textContent = logVisible ? 'Ocultar' : 'Mostrar';
  });

  // ========================================================
  // CALENDAR & MEMORIES CONTROLLER ("NESTE DIA")
  // ========================================================
  
  // Navigation
  const tabBackup = document.getElementById('tab-backup');
  const tabCalendar = document.getElementById('tab-calendar');
  const viewBackup = document.getElementById('view-backup');
  const viewCalendar = document.getElementById('view-calendar');
  const todayMemoriesBadge = document.getElementById('today-memories-badge');

  // Spotlight
  const spotlightTitle = document.getElementById('spotlight-title');
  const spotlightSubtitle = document.getElementById('spotlight-subtitle');
  const spotlightContent = document.getElementById('spotlight-content');
  const btnRefreshCalendarData = document.getElementById('btn-refresh-calendar-data');

  // Calendar
  const calPrevMonth = document.getElementById('cal-prev-month');
  const calNextMonth = document.getElementById('cal-next-month');
  const calMonthName = document.getElementById('cal-month-name');
  const calYearNumber = document.getElementById('cal-year-number');
  const calBtnToday = document.getElementById('cal-btn-today');
  const calendarDays = document.getElementById('calendar-days');

  // Selected Day Explorer
  const selectedDayTitle = document.getElementById('selected-day-title');
  const selectedDayCount = document.getElementById('selected-day-count');
  const memoriesContainer = document.getElementById('memories-container');

  // Lightbox
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxBackdrop = document.getElementById('lightbox-backdrop');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxPrev = document.getElementById('lightbox-prev');
  const lightboxNext = document.getElementById('lightbox-next');
  const lightboxMediaBox = document.getElementById('lightbox-media-box');
  const lightboxFilename = document.getElementById('lightbox-filename');
  const lightboxMeta = document.getElementById('lightbox-meta');
  const lightboxRevealBtn = document.getElementById('lightbox-reveal-btn');

  const monthNamesPt = [
    '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  const today = new Date();
  let currentCalYear = today.getFullYear();
  let currentCalMonth = today.getMonth() + 1; // 1-12
  let selectedDay = today.getDate();
  let selectedMonth = today.getMonth() + 1;

  let activeLightboxList = [];
  let activeLightboxIdx = 0;

  // View Switching
  function switchView(view) {
    tabBackup.classList.remove('active');
    tabCalendar.classList.remove('active');
    if (tabFaces) tabFaces.classList.remove('active');
    viewBackup.style.display = 'none';
    viewCalendar.style.display = 'none';
    if (viewFaces) viewFaces.style.display = 'none';

    if (view === 'calendar') {
      tabCalendar.classList.add('active');
      viewCalendar.style.display = 'block';
      loadSpotlight();
      renderCalendar(currentCalYear, currentCalMonth);
      loadDayMemories(selectedMonth, selectedDay);
    } else if (view === 'faces') {
      if (tabFaces) tabFaces.classList.add('active');
      if (viewFaces) viewFaces.style.display = 'block';
      loadFacesOverview();
    } else {
      tabBackup.classList.add('active');
      viewBackup.style.display = 'block';
    }
  }

  tabBackup.addEventListener('click', () => switchView('backup'));
  tabCalendar.addEventListener('click', () => switchView('calendar'));
  if (tabFaces) tabFaces.addEventListener('click', () => switchView('faces'));

  // 1. Load Spotlight (Today's memories)
  async function loadSpotlight() {
    try {
      const res = await fetch('/api/calendar/today');
      if (!res.ok) return;
      const data = await res.json();

      const todayStr = `${data.day} de ${data.monthName}`;
      spotlightTitle.textContent = `Recordações de ${todayStr} ao Longo dos Anos`;

      if (data.totalFiles > 0) {
        todayMemoriesBadge.style.display = 'inline-block';
        todayMemoriesBadge.textContent = data.totalFiles;
        spotlightSubtitle.textContent = `Encontradas ${data.totalFiles} fotos e vídeos tirados neste dia ao longo dos anos!`;
        renderMediaGroups(spotlightContent, data.years, true);
      } else {
        todayMemoriesBadge.style.display = 'none';
        spotlightSubtitle.textContent = `Nenhuma foto encontrada tirada no dia de hoje em anos anteriores.`;
        spotlightContent.innerHTML = `
          <div class="spotlight-empty">
            <span style="font-size: 36px; display: block; margin-bottom: 8px;">📷</span>
            <p>Ainda não há fotografias registadas para o dia de hoje (${todayStr}) nos seus backups.</p>
            <small style="color: var(--text-muted);">Explore outros dias no calendário abaixo para reviver momentos de datas especiais!</small>
          </div>
        `;
      }
    } catch (e) {
      console.error('Erro ao carregar destaque do dia:', e);
    }
  }

  // 2. Render Calendar Grid
  async function renderCalendar(year, month) {
    calMonthName.textContent = monthNamesPt[month];
    calYearNumber.textContent = year;
    calendarDays.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 20px; color: var(--text-muted);">A carregar...</div>';

    try {
      const mm = String(month).padStart(2, '0');
      const res = await fetch(`/api/calendar/month-summary?month=${mm}`);
      const summaryData = await res.json();
      const dayCounts = summaryData.days || {};

      calendarDays.innerHTML = '';

      // First day of month (0 = Sun, 1 = Mon ... 6 = Sat)
      const firstDayObj = new Date(year, month - 1, 1);
      let startDayOfWeek = firstDayObj.getDay(); // 0 is Sunday
      // Convert to Monday = 0, Sunday = 6
      startDayOfWeek = (startDayOfWeek + 6) % 7;

      const daysInMonth = new Date(year, month, 0).getDate();

      // Empty padding cells before 1st of month
      for (let i = 0; i < startDayOfWeek; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-day empty';
        calendarDays.appendChild(emptyCell);
      }

      // Day cells
      const isCurrentMonthReal = (today.getFullYear() === year && (today.getMonth() + 1) === month);

      for (let d = 1; d <= daysInMonth; d++) {
        const ddStr = String(d).padStart(2, '0');
        const count = dayCounts[ddStr] || 0;

        const cell = document.createElement('div');
        cell.className = 'cal-day';
        cell.textContent = d;

        if (count > 0) {
          cell.classList.add('has-photos');
          const badge = document.createElement('span');
          badge.className = 'cal-day-count';
          badge.textContent = count;
          cell.appendChild(badge);
        }

        if (isCurrentMonthReal && today.getDate() === d) {
          cell.classList.add('today');
        }

        if (selectedMonth === month && selectedDay === d) {
          cell.classList.add('active');
        }

        cell.addEventListener('click', () => {
          document.querySelectorAll('.cal-day.active').forEach(c => c.classList.remove('active'));
          cell.classList.add('active');
          selectedDay = d;
          selectedMonth = month;
          loadDayMemories(selectedMonth, selectedDay);
        });

        calendarDays.appendChild(cell);
      }
    } catch (e) {
      calendarDays.innerHTML = '<div style="grid-column: 1 / -1; color: var(--accent-red); padding: 10px;">Erro ao carregar calendário.</div>';
    }
  }

  // 3. Load Memories for a specific Day
  async function loadDayMemories(month, day) {
    selectedDayTitle.textContent = `Fotos de ${day} de ${monthNamesPt[month]}`;
    selectedDayCount.textContent = 'A carregar...';
    memoriesContainer.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">A carregar fotos...</div>';

    try {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const res = await fetch(`/api/calendar/day?month=${mm}&day=${dd}`);
      const data = await res.json();

      if (data.totalFiles === 0) {
        selectedDayCount.textContent = '0 fotos';
        memoriesContainer.innerHTML = `
          <div class="spotlight-empty">
            <span style="font-size: 32px; display: block; margin-bottom: 6px;">🍃</span>
            <p>Nenhuma foto tirada em <strong>${day} de ${monthNamesPt[month]}</strong> nos seus backups.</p>
            <small>Experimente selecionar um dia com contorno azul no calendário!</small>
          </div>
        `;
        return;
      }

      selectedDayCount.textContent = `${data.totalFiles} fotos e vídeos (${data.yearsCount} ${data.yearsCount === 1 ? 'ano' : 'anos'})`;
      renderMediaGroups(memoriesContainer, data.years, false);
    } catch (e) {
      memoriesContainer.innerHTML = `<div style="color: var(--accent-red); padding: 20px;">Falha ao carregar fotos: ${e.message}</div>`;
    }
  }

  // Helper: Render media grouped by year
  function renderMediaGroups(container, yearsObj, isSpotlight = false) {
    container.innerHTML = '';
    const years = Object.keys(yearsObj).sort((a, b) => b - a);

    const allGroupMedia = [];

    years.forEach(yr => {
      const items = yearsObj[yr] || [];
      if (items.length === 0) return;

      const yearBlock = document.createElement('div');
      yearBlock.className = 'memories-year-block';

      // Year Header with calculation: "Há X anos"
      const yearDiff = today.getFullYear() - parseInt(yr, 10);
      let diffText = '';
      if (yearDiff === 0) diffText = 'Este ano';
      else if (yearDiff === 1) diffText = 'Há 1 ano';
      else if (yearDiff > 1) diffText = `Há ${yearDiff} anos`;

      const header = document.createElement('div');
      header.className = 'memories-year-header';
      header.innerHTML = `
        <div class="memories-year-title">
          <span>📅 ${yr}</span>
          ${diffText ? `<span class="info-pill">${diffText}</span>` : ''}
        </div>
        <span class="info-pill">${items.length} ${items.length === 1 ? 'item' : 'itens'}</span>
      `;

      const grid = document.createElement('div');
      grid.className = 'memories-photo-grid';

      items.forEach(item => {
        const itemIdx = allGroupMedia.length;
        allGroupMedia.push(item);

        const card = document.createElement('div');
        card.className = 'photo-card';

        const mediaUrl = `/api/media?file=${encodeURIComponent(item.relPath)}`;

        if (item.type === 'video') {
          card.innerHTML = `
            <video src="${mediaUrl}#t=0.5" preload="metadata"></video>
            <span class="video-badge">▶ Vídeo</span>
            <div class="photo-card-info">${item.name}</div>
          `;
        } else {
          card.innerHTML = `
            <img src="${mediaUrl}" alt="${item.name}" loading="lazy">
            <div class="photo-card-info">${item.name}</div>
          `;
        }

        card.addEventListener('click', () => {
          openLightbox(allGroupMedia, itemIdx);
        });

        grid.appendChild(card);
      });

      yearBlock.appendChild(header);
      yearBlock.appendChild(grid);
      container.appendChild(yearBlock);
    });
  }

  // 4. Lightbox Modal Controller
  function openLightbox(list, index) {
    if (!list || list.length === 0) return;
    activeLightboxList = list;
    activeLightboxIdx = index;
    lightboxModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    updateLightboxContent();
  }

  function closeLightbox() {
    lightboxModal.style.display = 'none';
    document.body.style.overflow = '';
    lightboxMediaBox.innerHTML = '';
  }

  function updateLightboxContent() {
    const item = activeLightboxList[activeLightboxIdx];
    if (!item) return;

    lightboxFilename.textContent = item.name;
    if (item.day && item.month && item.year) {
      const dateFormatted = `${item.day} de ${monthNamesPt[item.month]} de ${item.year}`;
      lightboxMeta.textContent = `${dateFormatted} • ${item.sizeFormatted || ''}`;
    } else {
      lightboxMeta.textContent = item.sizeFormatted || item.relPath || '';
    }

    const mediaUrl = `/api/media?file=${encodeURIComponent(item.relPath)}`;
    lightboxMediaBox.innerHTML = '';

    if (item.type === 'video') {
      const vid = document.createElement('video');
      vid.src = mediaUrl;
      vid.controls = true;
      vid.autoplay = true;
      lightboxMediaBox.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = mediaUrl;
      img.alt = item.name;
      lightboxMediaBox.appendChild(img);
    }
  }

  lightboxClose.addEventListener('click', closeLightbox);
  lightboxBackdrop.addEventListener('click', closeLightbox);

  lightboxPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeLightboxList.length <= 1) return;
    activeLightboxIdx = (activeLightboxIdx - 1 + activeLightboxList.length) % activeLightboxList.length;
    updateLightboxContent();
  });

  lightboxNext.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeLightboxList.length <= 1) return;
    activeLightboxIdx = (activeLightboxIdx + 1) % activeLightboxList.length;
    updateLightboxContent();
  });

  // Keyboard navigation for Lightbox
  window.addEventListener('keydown', (e) => {
    if (lightboxModal.style.display === 'flex') {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') lightboxPrev.click();
      else if (e.key === 'ArrowRight') lightboxNext.click();
    }
  });

  // Reveal file in Explorer
  lightboxRevealBtn.addEventListener('click', async () => {
    const item = activeLightboxList[activeLightboxIdx];
    if (!item) return;
    try {
      await fetch('/api/open-in-explorer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: item.relPath })
      });
    } catch (e) {
      console.error(e);
    }
  });

  // Calendar Controls
  calPrevMonth.addEventListener('click', () => {
    currentCalMonth--;
    if (currentCalMonth < 1) {
      currentCalMonth = 12;
      currentCalYear--;
    }
    renderCalendar(currentCalYear, currentCalMonth);
  });

  calNextMonth.addEventListener('click', () => {
    currentCalMonth++;
    if (currentCalMonth > 12) {
      currentCalMonth = 1;
      currentCalYear++;
    }
    renderCalendar(currentCalYear, currentCalMonth);
  });

  calBtnToday.addEventListener('click', () => {
    currentCalYear = today.getFullYear();
    currentCalMonth = today.getMonth() + 1;
    selectedDay = today.getDate();
    selectedMonth = today.getMonth() + 1;
    renderCalendar(currentCalYear, currentCalMonth);
    loadDayMemories(selectedMonth, selectedDay);
  });

  if (btnRefreshCalendarData) {
    btnRefreshCalendarData.addEventListener('click', async () => {
      btnRefreshCalendarData.disabled = true;
      btnRefreshCalendarData.textContent = '⏳ A atualizar...';
      try {
        await fetch('/api/calendar/refresh', { method: 'POST' });
        await loadSpotlight();
        await renderCalendar(currentCalYear, currentCalMonth);
        await loadDayMemories(selectedMonth, selectedDay);
      } finally {
        btnRefreshCalendarData.disabled = false;
        btnRefreshCalendarData.textContent = '🔄 Atualizar Memórias';
      }
    });
  }

  // Preload spotlight in background so badge count is known on load
  loadSpotlight();

  // ========================================================
  // RECONHECIMENTO FACIAL E ORGANIZAÇÃO POR PESSOAS
  // ========================================================
  const tabFaces = document.getElementById('tab-faces');
  const viewFaces = document.getElementById('view-faces');
  const facesCountBadge = document.getElementById('faces-count-badge');

  const btnStartFaceScan = document.getElementById('btn-start-face-scan');
  const btnStopFaceScan = document.getElementById('btn-stop-face-scan');
  const btnOrganizeFacesFolders = document.getElementById('btn-organize-faces-folders');
  const btnResetFaces = document.getElementById('btn-reset-faces');

  const faceProgressPanel = document.getElementById('face-progress-panel');
  const faceProgressBar = document.getElementById('face-progress-bar');
  const faceScanStatusText = document.getElementById('face-scan-status-text');
  const faceScanPercentText = document.getElementById('face-scan-percent-text');
  const faceScanCurrentImg = document.getElementById('face-scan-current-img');
  const faceScanOverlayCanvas = document.getElementById('face-scan-overlay-canvas');
  const faceScanCurrentFile = document.getElementById('face-scan-current-file');
  const faceScanDetectedCount = document.getElementById('face-scan-detected-count');

  const statTotalImages = document.getElementById('stat-total-images');
  const statScannedImages = document.getElementById('stat-scanned-images');
  const statPersonsFound = document.getElementById('stat-persons-found');

  const personsOverviewSection = document.getElementById('persons-overview-section');
  const personsHeaderCount = document.getElementById('persons-header-count');
  const personsGrid = document.getElementById('persons-grid');

  const personDetailSection = document.getElementById('person-detail-section');
  const btnBackToPersons = document.getElementById('btn-back-to-persons');
  const personDetailAvatar = document.getElementById('person-detail-avatar');
  const personDetailName = document.getElementById('person-detail-name');
  const personDetailCount = document.getElementById('person-detail-count');
  const btnRenamePerson = document.getElementById('btn-rename-person');
  const btnMergePerson = document.getElementById('btn-merge-person');
  const personPhotosGrid = document.getElementById('person-photos-grid');

  let isFaceScanning = false;
  let modelsLoaded = false;
  let currentPersonsList = [];
  let currentSelectedPerson = null;

  async function ensureModelsLoaded() {
    if (modelsLoaded) return true;
    if (typeof faceapi === 'undefined') {
      throw new Error('A biblioteca face-api.js não foi carregada no navegador.');
    }
    if (faceScanStatusText) faceScanStatusText.textContent = 'A carregar modelos neurais locais (TinyFace, Landmarks, FaceNet)...';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models')
    ]);
    modelsLoaded = true;
    return true;
  }

  function loadImageAsync(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Falha ao carregar imagem: ' + src));
      img.src = src;
    });
  }

  function extractFaceAvatar(img, box) {
    try {
      const margin = 0.25;
      const x = Math.max(0, box.x - box.width * margin);
      const y = Math.max(0, box.y - box.height * margin);
      const w = Math.min(img.naturalWidth - x, box.width * (1 + margin * 2));
      const h = Math.min(img.naturalHeight - y, box.height * (1 + margin * 2));

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = 120;
      cropCanvas.height = 120;
      const ctx = cropCanvas.getContext('2d');
      ctx.drawImage(img, x, y, w, h, 0, 0, 120, 120);
      return cropCanvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      return '';
    }
  }

  function drawFaceOverlay(img, detections) {
    if (!faceScanOverlayCanvas) return;
    const canvas = faceScanOverlayCanvas;
    const previewWrapper = canvas.parentElement;
    if (!previewWrapper) return;

    const displayW = previewWrapper.clientWidth || 220;
    const displayH = previewWrapper.clientHeight || 180;
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, displayW, displayH);
    if (!detections || detections.length === 0) return;

    const scale = Math.min(displayW / img.naturalWidth, displayH / img.naturalHeight);
    const offsetX = (displayW - img.naturalWidth * scale) / 2;
    const offsetY = (displayH - img.naturalHeight * scale) / 2;

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#2563eb';
    ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';

    for (const det of detections) {
      const box = det.detection.box;
      const bx = offsetX + box.x * scale;
      const by = offsetY + box.y * scale;
      const bw = box.width * scale;
      const bh = box.height * scale;

      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillRect(bx, by, bw, bh);
    }
  }

  async function loadFacesOverview() {
    try {
      const res = await fetch('/api/faces/data');
      if (!res.ok) return;
      const data = await res.json();

      if (statTotalImages) statTotalImages.textContent = data.totalImages || 0;
      if (statScannedImages) statScannedImages.textContent = data.scannedCount || 0;
      if (statPersonsFound) statPersonsFound.textContent = (data.persons || []).length;
      if (personsHeaderCount) personsHeaderCount.textContent = `${(data.persons || []).length} pessoas`;

      if (facesCountBadge) {
        if (data.persons && data.persons.length > 0) {
          facesCountBadge.style.display = 'inline-block';
          facesCountBadge.textContent = data.persons.length;
        } else {
          facesCountBadge.style.display = 'none';
        }
      }

      currentPersonsList = data.persons || [];
      renderPersonsGrid();
    } catch (e) {
      console.error('Erro ao carregar dados faciais:', e);
    }
  }

  function renderPersonsGrid() {
    if (!personsGrid) return;
    personsGrid.innerHTML = '';

    if (currentPersonsList.length === 0) {
      personsGrid.innerHTML = `
        <div class="spotlight-empty" style="grid-column: 1 / -1;">
          <span style="font-size: 38px; display: block; margin-bottom: 8px;">👥</span>
          <p>Ainda não foram analisadas fotos ou nenhuma pessoa foi detetada.</p>
          <small style="color: var(--text-muted);">Clique em <strong>"🔍 Iniciar Reconhecimento Facial"</strong> acima para analisar as fotos automaticamente no seu computador!</small>
        </div>
      `;
      return;
    }

    currentPersonsList.forEach(person => {
      const card = document.createElement('div');
      card.className = 'person-card';

      const avatarHtml = person.avatar
        ? `<img src="${person.avatar}" alt="${person.name}" class="person-avatar-img">`
        : `<div class="person-avatar-fallback">👤</div>`;

      card.innerHTML = `
        <div class="person-avatar-wrapper">
          ${avatarHtml}
          <span class="person-photo-count-badge">${person.photoCount}</span>
        </div>
        <div class="person-info">
          <input type="text" class="person-name-input" value="${person.name}" title="Clique para editar o nome" spellcheck="false">
          <span class="person-photo-count">${person.photoCount} fotos</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm btn-view-person-photos">
          🖼️ Ver Fotos
        </button>
      `;

      // Inline renaming
      const nameInput = card.querySelector('.person-name-input');
      nameInput.addEventListener('change', async () => {
        const newName = nameInput.value.trim();
        if (!newName || newName === person.name) return;
        try {
          const res = await fetch('/api/faces/rename-person', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: person.id, name: newName })
          });
          const resData = await res.json();
          if (resData.success) {
            person.name = newName;
            addLocalLog(`Pessoa renomeada para "${newName}"`, 'info');
          }
        } catch (e) {
          console.error('Erro ao renomear pessoa:', e);
        }
      });
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameInput.blur();
      });

      const btnView = card.querySelector('.btn-view-person-photos');
      btnView.addEventListener('click', (e) => {
        e.stopPropagation();
        showPersonDetail(person);
      });

      card.addEventListener('click', (e) => {
        if (e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
        showPersonDetail(person);
      });

      personsGrid.appendChild(card);
    });
  }

  function showPersonDetail(person) {
    currentSelectedPerson = person;
    if (personsOverviewSection) personsOverviewSection.style.display = 'none';
    if (personDetailSection) personDetailSection.style.display = 'block';

    if (personDetailAvatar) {
      if (person.avatar) {
        personDetailAvatar.src = person.avatar;
        personDetailAvatar.style.display = 'block';
      } else {
        personDetailAvatar.style.display = 'none';
      }
    }

    if (personDetailName) personDetailName.textContent = person.name;
    if (personDetailCount) personDetailCount.textContent = `${person.photoCount} fotos`;

    if (!personPhotosGrid) return;
    personPhotosGrid.innerHTML = '';

    if (!person.files || person.files.length === 0) {
      personPhotosGrid.innerHTML = '<p style="grid-column: 1 / -1; padding: 20px; color: var(--text-muted);">Nenhuma fotografia associada a esta pessoa.</p>';
      return;
    }

    const personMediaItems = person.files.map(f => ({
      relPath: f,
      name: f.split('/').pop(),
      type: 'photo',
      sizeFormatted: ''
    }));

    person.files.forEach((fileRel, idx) => {
      const filename = fileRel.split('/').pop();
      const card = document.createElement('div');
      card.className = 'photo-card';
      const mediaUrl = `/api/media?file=${encodeURIComponent(fileRel)}`;

      card.innerHTML = `
        <img src="${mediaUrl}" alt="${filename}" loading="lazy">
        <div class="photo-card-info">${filename}</div>
      `;

      card.addEventListener('click', () => {
        openLightbox(personMediaItems, idx);
      });

      personPhotosGrid.appendChild(card);
    });
  }

  if (btnBackToPersons) {
    btnBackToPersons.addEventListener('click', () => {
      if (personDetailSection) personDetailSection.style.display = 'none';
      if (personsOverviewSection) personsOverviewSection.style.display = 'block';
      currentSelectedPerson = null;
      loadFacesOverview();
    });
  }

  if (btnRenamePerson) {
    btnRenamePerson.addEventListener('click', async () => {
      if (!currentSelectedPerson) return;
      const newName = prompt('Novo nome para esta pessoa:', currentSelectedPerson.name);
      if (newName && newName.trim() && newName.trim() !== currentSelectedPerson.name) {
        try {
          const res = await fetch('/api/faces/rename-person', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personId: currentSelectedPerson.id, name: newName.trim() })
          });
          const resData = await res.json();
          if (resData.success) {
            currentSelectedPerson.name = newName.trim();
            if (personDetailName) personDetailName.textContent = currentSelectedPerson.name;
            addLocalLog(`Pessoa renomeada para "${newName.trim()}"`, 'info');
          }
        } catch (e) {
          alert('Erro ao renomear: ' + e.message);
        }
      }
    });
  }

  if (btnMergePerson) {
    btnMergePerson.addEventListener('click', async () => {
      if (!currentSelectedPerson) return;
      const otherPersons = currentPersonsList.filter(p => p.id !== currentSelectedPerson.id);
      if (otherPersons.length === 0) {
        alert('Não existem outras pessoas para juntar.');
        return;
      }

      const listPrompt = otherPersons.map((p, idx) => `${idx + 1}. ${p.name} (${p.photoCount} fotos)`).join('\n');
      const chosenStr = prompt(
        `Juntar "${currentSelectedPerson.name}" com qual pessoa?\n\nDigite o número:\n${listPrompt}`
      );
      if (!chosenStr) return;
      const chosenIdx = parseInt(chosenStr, 10) - 1;
      if (isNaN(chosenIdx) || chosenIdx < 0 || chosenIdx >= otherPersons.length) {
        alert('Opção inválida.');
        return;
      }

      const targetPerson = otherPersons[chosenIdx];
      const confirmMerge = confirm(
        `Tem a certeza de que deseja juntar todas as fotos de "${currentSelectedPerson.name}" na pessoa "${targetPerson.name}"?`
      );
      if (!confirmMerge) return;

      try {
        const res = await fetch('/api/faces/merge-persons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId: currentSelectedPerson.id, targetId: targetPerson.id })
        });
        const resData = await res.json();
        if (resData.success) {
          alert(`Pessoas unidas com sucesso em "${targetPerson.name}"!`);
          if (btnBackToPersons) btnBackToPersons.click();
        } else {
          alert('Erro ao juntar: ' + (resData.error || 'Erro desconhecido'));
        }
      } catch (e) {
        alert('Erro ao comunicar com o servidor: ' + e.message);
      }
    });
  }

  if (btnStartFaceScan) {
    btnStartFaceScan.addEventListener('click', async () => {
      if (isFaceScanning) return;
      btnStartFaceScan.style.display = 'none';
      if (btnStopFaceScan) btnStopFaceScan.style.display = 'inline-block';
      if (faceProgressPanel) faceProgressPanel.style.display = 'block';
      isFaceScanning = true;

      try {
        if (faceScanStatusText) faceScanStatusText.textContent = 'A verificar fotografias e modelos locais...';
        await ensureModelsLoaded();

        const dataRes = await fetch('/api/faces/data');
        if (!dataRes.ok) throw new Error('Falha ao obter lista de imagens.');
        const data = await dataRes.json();

        if (statTotalImages) statTotalImages.textContent = data.totalImages || 0;
        if (statScannedImages) statScannedImages.textContent = data.scannedCount || 0;
        if (statPersonsFound) statPersonsFound.textContent = (data.persons || []).length;
        currentPersonsList = data.persons || [];
        renderPersonsGrid();

        const pending = data.pendingImages || [];
        const total = data.totalImages || 0;
        let scanned = data.scannedCount || 0;

        if (pending.length === 0) {
          if (faceScanStatusText) faceScanStatusText.textContent = `Todas as ${total} fotos já foram analisadas!`;
          if (faceProgressBar) faceProgressBar.style.width = '100%';
          if (faceScanPercentText) faceScanPercentText.textContent = '100%';
          isFaceScanning = false;
          btnStartFaceScan.style.display = 'inline-block';
          if (btnStopFaceScan) btnStopFaceScan.style.display = 'none';
          return;
        }

        let batch = [];

        async function flushScanBatch() {
          if (batch.length === 0) return;
          const sending = batch;
          batch = [];
          try {
            const res = await fetch('/api/faces/save-batch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ detections: sending })
            });
            const saved = await res.json();
            if (saved.success) {
              if (statScannedImages) statScannedImages.textContent = saved.scannedCount;
              if (statPersonsFound) statPersonsFound.textContent = (saved.persons || []).length;
              if (personsHeaderCount) personsHeaderCount.textContent = `${(saved.persons || []).length} pessoas`;
              currentPersonsList = saved.persons || [];
              if (facesCountBadge) {
                if (currentPersonsList.length > 0) {
                  facesCountBadge.style.display = 'inline-block';
                  facesCountBadge.textContent = currentPersonsList.length;
                }
              }
              renderPersonsGrid();
            }
          } catch (err) {
            console.error('Erro ao guardar lote:', err);
          }
        }

        for (let i = 0; i < pending.length; i++) {
          if (!isFaceScanning) break;
          const fileRel = pending[i];
          scanned++;
          const pct = Math.min(100, Math.round((scanned / total) * 100));

          if (faceProgressBar) faceProgressBar.style.width = `${pct}%`;
          if (faceScanPercentText) faceScanPercentText.textContent = `${pct}% (${scanned}/${total})`;
          if (faceScanCurrentFile) faceScanCurrentFile.textContent = fileRel.split('/').pop();
          if (faceScanStatusText) faceScanStatusText.textContent = `A analisar fotografia ${i + 1} de ${pending.length}...`;

          try {
            const mediaUrl = `/api/media?file=${encodeURIComponent(fileRel)}`;
            const img = await loadImageAsync(mediaUrl);

            if (faceScanCurrentImg) faceScanCurrentImg.src = mediaUrl;

            // Detect faces with landmarks & 128-d descriptors
            const detections = await faceapi.detectAllFaces(
              img,
              new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })
            ).withFaceLandmarks().withFaceDescriptors();

            if (faceScanDetectedCount) {
              faceScanDetectedCount.textContent = `${detections.length} ${detections.length === 1 ? 'rosto detetado' : 'rostos detetados'}`;
            }

            drawFaceOverlay(img, detections);

            if (detections.length === 0) {
              batch.push({ file: fileRel, descriptor: null });
            } else {
              for (const det of detections) {
                const avatar = extractFaceAvatar(img, det.detection.box);
                batch.push({
                  file: fileRel,
                  descriptor: Array.from(det.descriptor),
                  avatar: avatar
                });
              }
            }
          } catch (err) {
            console.warn('Erro ao processar imagem:', fileRel, err);
            batch.push({ file: fileRel, descriptor: null });
          }

          if (batch.length >= 6) {
            await flushScanBatch();
          }
        }

        // Final batch
        await flushScanBatch();

        if (faceScanStatusText) {
          faceScanStatusText.textContent = isFaceScanning
            ? 'Análise facial concluída com sucesso!'
            : 'Análise facial interrompida.';
        }
      } catch (err) {
        console.error('Erro na análise facial:', err);
        alert('Erro ao executar reconhecimento facial: ' + err.message);
      } finally {
        isFaceScanning = false;
        btnStartFaceScan.style.display = 'inline-block';
        if (btnStopFaceScan) btnStopFaceScan.style.display = 'none';
        loadFacesOverview();
      }
    });
  }

  if (btnStopFaceScan) {
    btnStopFaceScan.addEventListener('click', () => {
      isFaceScanning = false;
      btnStopFaceScan.disabled = true;
      btnStopFaceScan.textContent = 'A parar...';
      if (faceScanStatusText) faceScanStatusText.textContent = 'A interromper deteção...';
      setTimeout(() => {
        btnStopFaceScan.disabled = false;
        btnStopFaceScan.textContent = '⏹️ Parar Deteção';
        btnStopFaceScan.style.display = 'none';
        if (btnStartFaceScan) btnStartFaceScan.style.display = 'inline-block';
      }, 800);
    });
  }

  if (btnOrganizeFacesFolders) {
    btnOrganizeFacesFolders.addEventListener('click', async () => {
      const confirmOrg = confirm(
        'Deseja arrumar as fotografias em pastas individuais por pessoa na sua pasta de fotos?\n\n' +
        'Será criada uma pasta "Pessoas\\<NomeDaPessoa>" para cada pessoa identificada com as respetivas fotos copiadas.'
      );
      if (!confirmOrg) return;

      btnOrganizeFacesFolders.disabled = true;
      btnOrganizeFacesFolders.textContent = '⏳ A arrumar pastas...';

      try {
        const res = await fetch('/api/faces/organize-folders', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert(`Organização concluída!\n\nForam copiadas ${data.count} fotografias para as pastas de ${data.personsCount} pessoas.`);
          addLocalLog(`Fotos organizadas em pastas por pessoa (${data.count} fotos, ${data.personsCount} pessoas).`, 'success');
        } else {
          alert('Erro ao organizar pastas: ' + (data.error || 'Erro desconhecido'));
        }
      } catch (e) {
        alert('Erro ao comunicar com o servidor: ' + e.message);
      } finally {
        btnOrganizeFacesFolders.disabled = false;
        btnOrganizeFacesFolders.textContent = '📁 Arrumar Fotos em Pastas por Pessoa';
      }
    });
  }

  if (btnResetFaces) {
    btnResetFaces.addEventListener('click', async () => {
      const confirmReset = confirm(
        'Tem a certeza de que deseja reiniciar o reconhecimento facial?\n\n' +
        'Isto irá limpar todos os agrupamentos e identificações de pessoas para analisar tudo de novo do zero.'
      );
      if (!confirmReset) return;

      try {
        const res = await fetch('/api/faces/reset', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('Dados de reconhecimento facial reiniciados.');
          loadFacesOverview();
        }
      } catch (e) {
        alert('Erro ao reiniciar: ' + e.message);
      }
    });
  }

  // Preload faces data
  loadFacesOverview();

  // Start app
  fetchStatus();
  connectSSE();

  // Periodically refresh remotes in case user authorized in browser
  setInterval(() => {
    if (!isRunning) {
      fetch('/api/status')
        .then(res => res.json())
        .then(data => {
          updateRemotesUI(data.remotes);
        })
        .catch(() => {});
    }
  }, 4000);
});

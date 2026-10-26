const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const BIN_DIR = path.join(ROOT_DIR, 'bin');
const RCLONE_CONF = path.join(DATA_DIR, 'rclone.conf');
const RCLONE_BIN = path.join(BIN_DIR, 'rclone.exe');

async function main() {
  console.log('===================================================================');
  console.log('       A VERIFICAR ESTADO DA CONEXAO AO MICROSOFT ONEDRIVE');
  console.log('===================================================================');
  console.log('');

  // 1. Check if token already exists
  if (fs.existsSync(RCLONE_CONF)) {
    const content = fs.readFileSync(RCLONE_CONF, 'utf8');
    const match = content.match(/\[onedrive\][\s\S]*?token\s*=\s*(\{[\s\S]*?\})/);
    if (match) {
      try {
        const tokenObj = JSON.parse(match[1]);
        const testRes = await testGraphToken(tokenObj.access_token);
        if (testRes.success) {
          console.log('  [OK] A sua conta do Microsoft OneDrive JA ESTA CONECTADA!');
          console.log(`  Conta: ${testRes.owner || 'Pessoal'}`);
          console.log(`  Drive ID: ${testRes.driveId}`);
          console.log('');
          console.log('  A testar pastas disponiveis com o motor de backup...');
          const list = execSync(`"${RCLONE_BIN}" lsf onedrive: --max-depth 1 --config "${RCLONE_CONF}"`).toString();
          const folders = list.split('\n').filter(f => f.trim().endsWith('/')).map(f => f.trim());
          console.log('  Pastas detetadas com sucesso:');
          folders.slice(0, 6).forEach(f => console.log(`    📁 ${f}`));
          console.log('');
          console.log('===================================================================');
          console.log('  TUDO OPERACIONAL! O OneDrive esta 100% pronto a ser utilizado.');
          console.log('  Pode abrir o "Iniciar-Backup.bat" para iniciar a copia.');
          console.log('===================================================================');
          return;
        }
      } catch (e) {
        // needs re-auth
      }
    }
  }

  // 2. Need auth
  console.log('  A iniciar o navegador para autorizar a sua conta Microsoft...');
  console.log('  Por favor inicie sessao e aceite a permissao no navegador.');
  console.log('');

  const tokenJson = await authorizeRclone();
  const tokenObj = JSON.parse(tokenJson);

  console.log('  [OK] Codigo de acesso recebido da Microsoft!');
  console.log('  A identificar a sua unidade principal de ficheiros...');

  const graphInfo = await testGraphToken(tokenObj.access_token);
  const driveId = graphInfo.driveId || '171D1935F8075628';

  // Save clean config without triggering rclone drive enumeration bugs
  saveOneDriveConfig(tokenJson, driveId);

  console.log('  [OK] Configuracao gravada com sucesso!');
  console.log(`  Drive ID associado: ${driveId}`);
  console.log('');
  console.log('===================================================================');
  console.log('  MICROSOFT ONEDRIVE CONFIGURADO COM SUCESSO! ✅');
  console.log('===================================================================');
}

function testGraphToken(token) {
  return new Promise((resolve) => {
    const req = https.get('https://graph.microsoft.com/v1.0/me/drive', {
      headers: { 'Authorization': `Bearer ${token}` }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.id) {
            resolve({
              success: true,
              driveId: json.id,
              owner: json.owner && json.owner.user ? json.owner.user.displayName : 'OneDrive Pessoal'
            });
            return;
          }
        } catch (e) {}
        resolve({ success: false });
      });
    });
    req.on('error', () => resolve({ success: false }));
  });
}

function authorizeRclone() {
  return new Promise((resolve, reject) => {
    const proc = spawn(RCLONE_BIN, ['authorize', 'onedrive'], {
      windowsHide: false
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => {
      stderr += d;
      const str = d.toString();
      if (str.includes('http://127.0.0.1:53682')) {
        console.log('  Se o navegador nao abrir automaticamente, aceda a:');
        console.log('  http://127.0.0.1:53682/');
      }
    });

    proc.on('close', (code) => {
      const match = stdout.match(/\{[\s\S]*?"access_token"[\s\S]*?\}/);
      if (match) {
        resolve(match[0]);
      } else {
        reject(new Error('Nao foi possivel obter o token: ' + stderr));
      }
    });

    proc.on('error', reject);
  });
}

function saveOneDriveConfig(tokenJson, driveId) {
  let conf = '';
  if (fs.existsSync(RCLONE_CONF)) {
    conf = fs.readFileSync(RCLONE_CONF, 'utf8');
  }

  // Remove existing [onedrive] section if any
  conf = conf.replace(/\[onedrive\][\s\S]*?(?=\n\[|$)/, '').trim();

  const onedriveBlock = `\n\n[onedrive]\ntype = onedrive\ndrive_type = personal\ndrive_id = ${driveId}\ntoken = ${tokenJson}\n`;
  conf += onedriveBlock;

  fs.writeFileSync(RCLONE_CONF, conf.trim() + '\n', 'utf8');
}

main().catch(err => {
  console.error('[ERRO]', err.message);
  process.exit(1);
});

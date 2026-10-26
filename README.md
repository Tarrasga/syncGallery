# 📸 syncGallery

Aplicação visual, rápida e inteligente para centralizar e juntar **todas as suas fotografias e vídeos** do **Google Drive**, **Microsoft OneDrive**, **Pen Drives** e **Discos Externos/Locais** diretamente numa **única pasta sem subpastas**.

---

## 🚀 Como Iniciar a Aplicação

Basta dar **duplo clique** num dos atalhos:
👉 **`Iniciar-syncGallery.bat`** (ou `Iniciar-Backup.bat`)

O servidor local é iniciado e o painel visual abre automaticamente no seu navegador em `http://localhost:3344`.

---

## ✨ Principais Funcionalidades

1. **⚡ Organização Flexível (Tudo Numa Só Pasta, Por Anos ou Por Origem):**
   - **Tudo Direto na Pasta (Sem Subpastas):** Elimina pastas aninhadas e mantém todas as fotografias e vídeos diretamente na raiz da pasta escolhida (por exemplo, `E:\Backup_Fotos`).
   - **📅 Separar por Anos:** Botão e modo para organizar as fotos automaticamente em pastas por cada ano (`/2024/`, `/2023/`, `/2022/`...) com base na data em que a foto foi tirada (metadados EXIF, nome do ficheiro ou data de modificação).
   - **⚡ Desfazer Pastas:** Botão para voltar a juntar tudo numa pasta só com 1 clique sempre que quiser.
   - **Separar por Origem:** Cria as pastas `/Google_Drive/`, `/OneDrive/` e `/Discos_Externos/`.

2. **🔌 Importação de Pen Drives e Discos Externos:**
   - Deteta automaticamente as pen drives e discos conectados (`F:\`, `E:\`, `C:\`, etc.).
   - Basta clicar na pen drive ou introduzir a letra da unidade para que todas as fotos e vídeos sejam recolhidos e agrupados com os do Google Drive e OneDrive.

3. **☁️ Integração com Google Drive & Microsoft OneDrive:**
   - **Google Drive:** Autorização oficial OAuth com 1 clique. Varre todo o armazenamento (incluindo pastas sincronizadas como `Saved Pictures`, `fotos`, etc.).
   - **Microsoft OneDrive:** 
     - *Modo Nuvem Direta:* Descarrega diretamente dos servidores da Microsoft via API oficial.
     - *Modo Local (Ultra-Rápido):* Copia diretamente da pasta sincronizada no seu computador sem gastar internet.

4. **🎞️ Formatos Multimédia Suportados:**
   - **Fotografias:** `JPG`, `JPEG`, `PNG`, `HEIC`, `HEIF`, `WEBP`, `GIF`, `BMP`, `TIFF`, `RAW`, `CR2`, `CR3`, `NEF`, `ARW`, `DNG`, `ORF`, `RW2`, `PEF`.
   - **Vídeos:** `MP4`, `MOV`, `AVI`, `MKV`, `WEBM`, `M4V`, `3GP`, `WMV`, `FLV`.

5. **🛡️ Backup Incremental Inteligente:**
   - Só transfere fotos e vídeos novos ou alterados. Ficheiros que já existam no destino com o mesmo tamanho são ignorados, poupando tempo e largura de banda.

6. **📊 Acompanhamento em Tempo Real:**
   - Percentagem concluída, velocidade de transferência (MB/s), contador de ficheiros e exibição do ficheiro em transferência a cada segundo.
   - Terminal de eventos ao vivo para acompanhamento detalhado.

7. **📅 Calendário de Memórias & Destaque do Dia ("Neste Dia"):**
   - **Destaque do Dia:** Mostra automaticamente no topo as fotos tiradas no dia de hoje em anos anteriores ("Há 2 anos", "Há 5 anos"...).
   - **Calendário Interativo:** Permite navegar por qualquer mês do ano e ver quantos ficheiros existem em cada dia.
   - **Explorador por Dia:** Ao clicar em qualquer dia no calendário, apresenta todas as fotos e vídeos tirados nessa data agrupados por ano.
   - **Visualizador Integrado (Lightbox):** Clique em qualquer foto ou vídeo para ver em ecrã grande com suporte de navegação (setas do teclado), reprodução de vídeos e botão para revelar o ficheiro no Explorador do Windows.

---

## 📂 Estrutura do Projeto

```text
gravi/
├── bin/
│   └── rclone.exe            # Motor de sincronização otimizado para nuvem
├── data/
│   ├── config.json           # Definições guardadas (pastas, preferências)
│   └── rclone.conf           # Tokens de autenticação encriptados localmente
├── public/
│   ├── index.html            # Interface web do painel syncGallery
│   ├── app.js                # Controlador do painel e ligação em tempo real
│   └── styles.css            # Estilos visuais modernos
├── server/
│   ├── server.js             # Servidor HTTP Node.js e orquestrador
│   └── setup-onedrive.js     # Assistente de configuração direta do OneDrive
├── Iniciar-syncGallery.bat    # Atalho principal para abrir a aplicação
├── Iniciar-Backup.bat         # Atalho alternativo de arranque
├── Configurar-Contas.bat      # Assistente de autenticação das nuvens
└── README.md
```

---

## 🔒 Privacidade e Segurança

- Todo o processo decorre **100% no seu computador**.
- As suas fotos e credenciais de acesso nunca passam por nenhum servidor de terceiros.

'use strict';

/* =========================================================================
   NowPlace — MVP
   Recursos nativos: getUserMedia, Canvas, Geolocation, localStorage,
   Fetch (Nominatim), Drag and Drop, DOM e eventos.
   ========================================================================= */

/* ========== CONFIGURAÇÃO ========== */
/* Troque a URL abaixo pela API oficial da professora quando disponível.   */
const CONFIG = {
  reverseGeocodeUrl: (lat, lon) =>
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}` +
    `&zoom=18&addressdetails=1&accept-language=pt-BR`
};

/* ========== STORAGE ========== */
const STORAGE = {
  USER: 'nowplace:user',
  NOWS: 'nowplace:nows'
};

/* ========== ESTADO ========== */
const state = {
  user: null,
  stream: null,
  facingMode: 'environment',
  stage: null,               // 'env' | 'selfie' | null
  photos: { env: null, selfie: null },
  location: null             // { lat, lon, label }
};

/* ========== DOM ========== */
const $ = (id) => document.getElementById(id);

const el = {
  // login
  screenLogin:   $('screen-login'),
  screenApp:     $('screen-app'),
  inputName:     $('inputName'),
  btnEnter:      $('btnEnter'),
  loginMsg:      $('loginMsg'),
  userBadge:     $('userBadge'),
  userNameLabel: $('userNameLabel'),
  btnLogout:     $('btnLogout'),

  // tabs
  tabs: document.querySelectorAll('.tab'),

  // câmera
  video:         $('video'),
  cameraOverlay: $('cameraOverlay'),
  cameraHint:    $('cameraHint'),
  captureBadge:  $('captureBadge'),
  btnStartCam:   $('btnStartCam'),
  btnCapture:    $('btnCapture'),
  btnStopCam:    $('btnStopCam'),
  cameraMsg:     $('cameraMsg'),

  // previews
  previewEnv:    $('previewEnv'),
  previewSelfie: $('previewSelfie'),
  inputDesc:     $('inputDesc'),
  locationLabel: $('locationLabel'),
  btnPublish:    $('btnPublish'),
  publishMsg:    $('publishMsg'),

  // feed
  selectRadius:   $('selectRadius'),
  btnRefreshFeed: $('btnRefreshFeed'),
  feedLocked:     $('feedLocked'),
  feedList:       $('feedList'),
  feedMsg:        $('feedMsg')
};

/* =========================================================================
   UTILITÁRIOS
   ========================================================================= */

function msg(node, texto, tipo = '') {
  node.textContent = texto;
  node.className = 'msg' + (tipo ? ' ' + tipo : '');
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
         Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatarTempo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)    return 'agora';
  if (diff < 3600)  return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* =========================================================================
   STORAGE
   ========================================================================= */

function carregarUsuario() {
  try {
    const raw = localStorage.getItem(STORAGE.USER);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function salvarUsuario(user) {
  localStorage.setItem(STORAGE.USER, JSON.stringify(user));
}

function carregarNows() {
  try {
    const raw = localStorage.getItem(STORAGE.NOWS);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function salvarNows(nows) {
  try {
    localStorage.setItem(STORAGE.NOWS, JSON.stringify(nows));
    return true;
  } catch (e) {
    console.error('Falha ao salvar (quota?):', e);
    return false;
  }
}

/**
 * RN05 — Verifica se o usuário publicou algum Now nas últimas 24h.
 * Retorna o Now mais recente dentro da janela ou null.
 */
function publicacaoRecente24h(userId) {
  const limite = Date.now() - 24 * 60 * 60 * 1000;
  const nows = carregarNows()
    .filter(n => n.userId === userId && n.createdAt >= limite)
    .sort((a, b) => b.createdAt - a.createdAt);
  return nows[0] || null;
}

/* =========================================================================
   LOGIN
   ========================================================================= */

function entrar() {
  const nome = el.inputName.value.trim();
  if (nome.length < 2) {
    msg(el.loginMsg, 'Digite um nome com pelo menos 2 caracteres.', 'erro');
    return;
  }
  let user = carregarUsuario();
  if (!user) {
    user = { id: uid(), nome };
    salvarUsuario(user);
  } else {
    user.nome = nome;
    salvarUsuario(user);
  }
  state.user = user;
  iniciarApp();
}

function iniciarApp() {
  el.screenLogin.classList.remove('active');
  el.screenApp.classList.add('active');
  el.userBadge.hidden = false;
  el.userNameLabel.textContent = `Olá, ${state.user.nome}`;
  atualizarFeed();
}

function sair() {
  pararCamera();
  localStorage.removeItem(STORAGE.USER);
  state.user = null;
  state.photos = { env: null, selfie: null };
  state.location = null;
  el.userBadge.hidden = true;
  el.screenApp.classList.remove('active');
  el.screenLogin.classList.add('active');
  el.inputName.value = '';
  el.inputName.focus();
}

/* =========================================================================
   TABS / NAVEGAÇÃO
   ========================================================================= */

function irParaView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  el.tabs.forEach(t => t.classList.toggle('active', t.dataset.target === viewId));
  if (viewId === 'view-feed') atualizarFeed();
}

el.tabs.forEach(tab => {
  tab.addEventListener('click', () => irParaView(tab.dataset.target));
});

/* =========================================================================
   CÂMERA
   ========================================================================= */

async function iniciarCamera(facingMode) {
  try {
    /* 1) Navegador tem suporte? */
    if (!navigator.mediaDevices?.getUserMedia) {
      msg(el.cameraMsg,
        'Navegador sem suporte a getUserMedia. Use Chrome/Firefox atualizado.',
        'erro');
      return;
    }

    /* 2) Contexto seguro? (getUserMedia exige HTTPS ou localhost) */
    const seguro =
      location.protocol === 'https:' ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';

    if (!seguro) {
      msg(el.cameraMsg,
        `A câmera só funciona em HTTPS ou localhost. Você está em: ${location.origin}`,
        'erro');
      return;
    }

    /* 3) Encerra stream anterior antes de abrir outro */
    pararCamera(true);

    /* 4) Pede permissão e abre a câmera */
    msg(el.cameraMsg, 'Solicitando permissão da câmera…');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width:  { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    });

    state.stream = stream;
    state.facingMode = facingMode;
    el.video.srcObject = stream;

    try { await el.video.play(); } catch { /* autoplay pode ser bloqueado */ }

    el.video.classList.add('ativa');
    el.cameraOverlay.classList.add('oculto');

    atualizarBotoesCamera();

    if (state.stage === 'selfie') {
      el.captureBadge.hidden = false;
      el.captureBadge.textContent = '🤳 Capturando SELFIE';
      msg(el.cameraMsg, 'Enquadre seu rosto e clique em Capturar.', 'ok');
    } else {
      el.captureBadge.hidden = false;
      el.captureBadge.textContent = '🏞️ Capturando AMBIENTE';
      msg(el.cameraMsg, 'Aponte a câmera para o ambiente e clique em Capturar.', 'ok');
    }

  } catch (err) {
    console.error('❌ iniciarCamera falhou:', err);
    tratarErroCamera(err);
  }
}

function tratarErroCamera(err) {
  const mensagens = {
    NotAllowedError:      'Permissão da câmera negada. Libere o acesso no ícone do cadeado ao lado do endereço.',
    SecurityError:        'Acesso à câmera bloqueado pelo navegador. Use HTTPS ou localhost.',
    NotFoundError:        'Nenhuma câmera encontrada neste dispositivo.',
    OverconstrainedError: 'Esta câmera não suporta o modo solicitado (ambiente/selfie).',
    NotReadableError:     'A câmera está em uso por outro aplicativo. Feche-o e tente novamente.',
    AbortError:           'Acesso à câmera foi interrompido inesperadamente.'
  };
  msg(el.cameraMsg,
    mensagens[err.name] || `Não foi possível acessar a câmera (${err.name}).`,
    'erro');
}

function pararCamera(silencioso = false) {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    console.log('🎥 Stream encerrado (tracks parados).');
  }
  state.stream = null;
  el.video.srcObject = null;
  el.video.classList.remove('ativa');
  el.cameraOverlay.classList.remove('oculto');
  el.captureBadge.hidden = true;

  if (!silencioso) {
    el.cameraHint.innerHTML = 'Câmera desligada. Clique em <strong>Iniciar Câmera</strong>.';
    atualizarBotoesCamera();
  }
}

function atualizarBotoesCamera() {
  const ligada = state.stream !== null;
  el.btnStopCam.disabled = !ligada;
  el.btnStartCam.disabled = ligada && state.stage !== null;
  el.btnCapture.disabled = !ligada;

  if (!ligada) {
    el.btnStartCam.textContent = state.photos.env
      ? '🤳 Iniciar Câmera (Selfie)'
      : '🎥 Iniciar Câmera';
  } else {
    el.btnStartCam.textContent = '🎥 Câmera ativa';
  }

  const temFotos = state.photos.env && state.photos.selfie;
  const temDesc  = el.inputDesc.value.trim().length > 0;
  el.btnPublish.disabled = !(temFotos && temDesc && state.location);
}

/* =========================================================================
   CAPTURA — Canvas + DataURL
   ========================================================================= */

function capturarFrame() {
  if (!state.stream || el.video.readyState < 2 || el.video.videoWidth === 0) {
    msg(el.cameraMsg,
      'A câmera ainda está iniciando. Aguarde um instante e tente novamente.',
      'erro');
    return null;
  }

  const MAX = 720;
  const vw = el.video.videoWidth;
  const vh = el.video.videoHeight;
  const scale = Math.min(1, MAX / Math.max(vw, vh));
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Selfie espelhada (mais natural para o usuário)
  if (state.facingMode === 'user') {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(el.video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.7);
}

async function capturar() {
  const dataURL = capturarFrame();
  if (!dataURL) return;

  if (state.stage === 'env') {
    state.photos.env = dataURL;
    el.previewEnv.src = dataURL;
    el.previewEnv.classList.add('visivel');
    state.stage = 'selfie';

    pararCamera(true);
    msg(el.cameraMsg, 'Ambiente capturado! Agora a selfie…', 'ok');
    await iniciarCamera('user');

  } else if (state.stage === 'selfie') {
    state.photos.selfie = dataURL;
    el.previewSelfie.src = dataURL;
    el.previewSelfie.classList.add('visivel');
    state.stage = null;

    pararCamera();
    msg(el.cameraMsg, 'Selfie capturada! Finalize sua publicação.', 'ok');

    obterLocalizacao();
  }

  atualizarBotoesCamera();
}

/* =========================================================================
   GEOLOCALIZAÇÃO + REVERSE GEOCODING
   ========================================================================= */

async function obterLocalizacao() {
  el.locationLabel.textContent = 'Obtendo sua localização…';

  if (!navigator.geolocation) {
    el.locationLabel.textContent = 'Geolocalização não suportada neste navegador.';
    return;
  }

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    });

    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    el.locationLabel.textContent = 'Consultando nome do local…';

    const label = await reverseGeocode(lat, lon);

    state.location = { lat, lon, label };
    el.locationLabel.textContent = `📍 ${label}`;
    el.locationLabel.parentElement.classList.add('ativo');

    atualizarBotoesCamera();

  } catch (err) {
    const motivos = {
      1: 'Permissão de localização negada. Libere o acesso para publicar um Now.',
      2: 'Não foi possível determinar sua posição. Verifique o GPS/sinal.',
      3: 'Tempo esgotado ao obter localização. Tente novamente.'
    };
    el.locationLabel.textContent = motivos[err.code] || 'Erro ao obter localização.';
    state.location = null;
    atualizarBotoesCamera();
  }
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(CONFIG.reverseGeocodeUrl(lat, lon), {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if (data.display_name) return data.display_name;

    const a = data.address || {};
    const partes = [a.road, a.suburb, a.city || a.town || a.village, a.state]
      .filter(Boolean);
    return partes.length
      ? partes.join(', ')
      : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

  } catch (e) {
    console.warn('Reverse geocode falhou:', e);
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}

/* =========================================================================
   PUBLICAÇÃO
   ========================================================================= */

function publicar() {
  const descricao = el.inputDesc.value.trim();

  if (!state.photos.env || !state.photos.selfie) {
    msg(el.publishMsg, 'Capture as duas fotos antes de publicar.', 'erro');
    return;
  }
  if (!descricao) {
    msg(el.publishMsg, 'Descreva o que você está fazendo.', 'erro');
    return;
  }
  if (!state.location) {
    msg(el.publishMsg,
      'Aguardando localização. Verifique a permissão de GPS e tente novamente.',
      'erro');
    return;
  }

  const now = {
    id: uid(),
    userId: state.user.id,
    userName: state.user.nome,
    description: descricao,
    lat: state.location.lat,
    lon: state.location.lon,
    locationLabel: state.location.label,
    photos: { env: state.photos.env, selfie: state.photos.selfie },
    mainPhoto: 'env',
    createdAt: Date.now()
  };

  const nows = carregarNows();
  nows.push(now);

  if (!salvarNows(nows)) {
    msg(el.publishMsg,
      'Não foi possível salvar (memória cheia). Tente excluir Nows antigos.',
      'erro');
    return;
  }

  msg(el.publishMsg, 'Now publicado com sucesso! 🎉', 'ok');
  resetFormulario();

  setTimeout(() => irParaView('view-feed'), 700);
}

function resetFormulario() {
  state.photos = { env: null, selfie: null };
  state.location = null;
  state.stage = null;

  el.previewEnv.classList.remove('visivel');
  el.previewSelfie.classList.remove('visivel');
  el.previewEnv.src = '';
  el.previewSelfie.src = '';
  el.inputDesc.value = '';
  el.locationLabel.textContent = 'Localização será obtida ao publicar.';
  el.locationLabel.parentElement.classList.remove('ativo');
  msg(el.publishMsg, '');
  atualizarBotoesCamera();
}

/* =========================================================================
   FEED — Regra das 24h + Proximidade
   ========================================================================= */

async function atualizarFeed() {
  if (!state.user) return;
  msg(el.feedMsg, '');

  const recente = publicacaoRecente24h(state.user.id);
  if (!recente) {
    el.feedLocked.hidden = false;
    el.feedList.innerHTML = '';
    return;
  }
  el.feedLocked.hidden = true;

  let refLat = recente.lat;
  let refLon = recente.lon;

  if (navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 6000,
          maximumAge: 60000
        });
      });
      refLat = pos.coords.latitude;
      refLon = pos.coords.longitude;
    } catch { /* usa a do Now mais recente */ }
  }

  const raioKm = Number(el.selectRadius.value);
  const nows = carregarNows();

  const proximos = nows
    .filter(n => n.userId !== state.user.id)
    .map(n => ({ ...n, distancia: haversineKm(refLat, refLon, n.lat, n.lon) }))
    .filter(n => n.distancia <= raioKm)
    .sort((a, b) => b.createdAt - a.createdAt);

  renderizarFeed(proximos, raioKm);
}

function renderizarFeed(lista, raioKm) {
  el.feedList.innerHTML = '';

  if (!lista.length) {
    const empty = document.createElement('div');
    empty.className = 'feed-empty';
    empty.innerHTML = `
      <p>🌫️ Nenhum Now encontrado num raio de <strong>${raioKm} km</strong>.</p>
      <p>Tente aumentar o raio de busca ou volte mais tarde.</p>
    `;
    el.feedList.appendChild(empty);
    return;
  }

  lista.forEach(now => {
    el.feedList.appendChild(criarCard(now));
  });
}

/* =========================================================================
   CARD + DRAG AND DROP
   ========================================================================= */

function criarCard(now) {
  const card = document.createElement('article');
  card.className = 'now-card';
  card.dataset.main = now.mainPhoto || 'env';

  const stack = document.createElement('div');
  stack.className = 'photo-stack';

  const imgEnv    = criarImg('env',    now.photos.env,    'Foto do ambiente');
  const imgSelfie = criarImg('selfie', now.photos.selfie, 'Selfie');

  const hint = document.createElement('span');
  hint.className = 'photo-hint';
  hint.textContent = '↔ arraste para trocar';

  stack.append(imgEnv, imgSelfie, hint);
  card.append(stack);

  const info = document.createElement('div');
  info.className = 'card-info';
  info.innerHTML = `
    <h3>${escapeHTML(now.userName)} <span class="badge">${now.distancia.toFixed(1)} km</span></h3>
    <p class="desc">${escapeHTML(now.description)}</p>
    <p class="meta">
      <span>📍 ${escapeHTML(now.locationLabel || 'Local não identificado')}</span>
      <span>•</span>
      <span>${formatarTempo(now.createdAt)}</span>
    </p>
  `;
  card.append(info);

  atualizarPosicoes(card);
  configurarDragDrop(card, now);

  return card;
}

function criarImg(role, src, alt) {
  const img = document.createElement('img');
  img.className = 'photo';
  img.src = src;
  img.alt = alt;
  img.draggable = true;
  img.dataset.role = role;
  return img;
}

function atualizarPosicoes(card) {
  const main = card.dataset.main;
  card.querySelectorAll('.photo').forEach(img => {
    const ehMain = img.dataset.role === main;
    img.classList.toggle('photo-main', ehMain);
    img.classList.toggle('photo-secondary', !ehMain);
  });
}

function configurarDragDrop(card, now) {
  let draggedRole = null;

  card.querySelectorAll('.photo').forEach(img => {
    img.addEventListener('dragstart', (e) => {
      draggedRole = img.dataset.role;
      img.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', draggedRole); } catch {}
    });

    img.addEventListener('dragend', () => {
      img.classList.remove('dragging');
      card.querySelectorAll('.photo').forEach(i => i.classList.remove('drag-over'));
      draggedRole = null;
    });

    img.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      img.classList.add('drag-over');
    });

    img.addEventListener('dragleave', () => img.classList.remove('drag-over'));

    img.addEventListener('drop', (e) => {
      e.preventDefault();
      img.classList.remove('drag-over');

      const origem = e.dataTransfer.getData('text/plain') || draggedRole;
      if (!origem || origem === img.dataset.role) return;

      card.dataset.main = card.dataset.main === 'env' ? 'selfie' : 'env';
      atualizarPosicoes(card);

      const nows = carregarNows();
      const alvo = nows.find(n => n.id === now.id);
      if (alvo) {
        alvo.mainPhoto = card.dataset.main;
        salvarNows(nows);
      }
    });
  });
}

/* =========================================================================
   HELPERS
   ========================================================================= */

function escapeHTML(str = '') {
  return String(str).replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[s]);
}

/* =========================================================================
   EVENTOS
   ========================================================================= */

// Login
el.btnEnter.addEventListener('click', entrar);
el.inputName.addEventListener('keydown', e => {
  if (e.key === 'Enter') entrar();
});
el.btnLogout.addEventListener('click', sair);

// Câmera
el.btnStartCam.addEventListener('click', () => {
  if (state.photos.env && !state.photos.selfie) {
    state.stage = 'selfie';
    iniciarCamera('user');
  } else {
    state.stage = 'env';
    iniciarCamera('environment');
  }
});

el.btnCapture.addEventListener('click', capturar);

el.btnStopCam.addEventListener('click', () => {
  pararCamera();
  msg(el.cameraMsg, 'Câmera desligada e hardware liberado.', '');
});

// Formulário
el.inputDesc.addEventListener('input', atualizarBotoesCamera);
el.btnPublish.addEventListener('click', publicar);

// Feed
el.btnRefreshFeed.addEventListener('click', atualizarFeed);
el.selectRadius.addEventListener('change', atualizarFeed);

// Botões [data-target] (ex.: dentro do feed bloqueado)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-target]');
  if (btn && btn.classList.contains('btn')) {
    irParaView(btn.dataset.target);
  }
});

// Libera a câmera ao sair da página
window.addEventListener('beforeunload', () => {
  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
});

/* =========================================================================
   INICIALIZAÇÃO
   ========================================================================= */

(function init() {
  const user = carregarUsuario();
  if (user) {
    state.user = user;
    iniciarApp();
  } else {
    el.inputName.focus();
  }
  atualizarBotoesCamera();
})();
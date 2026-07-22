/* Closet Sully — lógica de la PWA con roles (JavaScript puro, sin build). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (n) => '$' + (Number(n) || 0).toFixed(2);

let token = localStorage.getItem('cs_token') || null;
let sesion = null; // { usuario, nombre, rol }

// ---- API helper (agrega el token; maneja 401) ------------------------------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(path, {
    headers, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { cerrarSesion(true); throw new Error('Sesión expirada'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de red');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._id);
  toast._id = setTimeout(() => (t.hidden = true), 2600);
}

// ===========================================================================
// SESIÓN
// ===========================================================================
async function iniciarApp() {
  if (!token) return mostrarLogin();
  try {
    const r = await api('/api/me');
    sesion = r.usuario;
    entrarAlSistema();
  } catch (_) {
    mostrarLogin();
  }
}

function mostrarLogin() {
  $('#login').style.display = 'flex';
  $('.topbar').hidden = true;
  $('#app').hidden = true;
  $('.tabbar').hidden = true;
}

function entrarAlSistema() {
  $('#login').style.display = 'none';
  $('.topbar').hidden = false;
  $('#app').hidden = false;
  $('.tabbar').hidden = false;
  $('#userName').textContent = sesion.nombre;
  $('#userRol').textContent = sesion.rol === 'master' ? 'Maestro' : 'Vendedor';
  aplicarRol();
  irA('catalogo');
}

function aplicarRol() {
  const esMaster = sesion.rol === 'master';
  $$('.only-master').forEach((el) => { el.style.display = esMaster ? '' : 'none'; });
}

async function login() {
  const usuario = $('#loginUser').value.trim();
  const password = $('#loginPass').value;
  $('#loginError').textContent = '';
  if (!usuario || !password) { $('#loginError').textContent = 'Escribe usuario y contraseña.'; return; }
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    });
    const data = await r.json();
    if (!r.ok) { $('#loginError').textContent = data.error || 'No se pudo iniciar sesión.'; return; }
    token = data.token;
    sesion = data.usuario;
    localStorage.setItem('cs_token', token);
    $('#loginPass').value = '';
    entrarAlSistema();
  } catch (e) {
    $('#loginError').textContent = 'Error de conexión.';
  }
}
$('#loginBtn').addEventListener('click', login);
$('#loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

async function cerrarSesion(silencioso) {
  if (token && !silencioso) { try { await api('/api/logout', { method: 'POST' }); } catch (_) {} }
  token = null; sesion = null;
  localStorage.removeItem('cs_token');
  detenerEscaner();
  mostrarLogin();
}

$('#userBtn').addEventListener('click', () => {
  abrirModal('Mi cuenta', `
    <p class="hint">${escapeHtml(sesion.nombre)} · ${sesion.rol === 'master' ? 'Usuario maestro' : 'Vendedor'}</p>
    <button class="btn btn-block" id="btnCambiarPass">Cambiar mi contraseña</button>
    <button class="btn btn-block btn-ghost" id="btnLogout" style="margin-top:8px">Cerrar sesión</button>
  `);
  $('#btnLogout').addEventListener('click', () => { cerrarModal(); cerrarSesion(); });
  $('#btnCambiarPass').addEventListener('click', formCambiarPassword);
});

function formCambiarPassword() {
  abrirModal('Cambiar contraseña', `
    <div class="field"><label>Contraseña actual</label><input id="p_actual" type="password" /></div>
    <div class="field"><label>Nueva contraseña (mín. 6)</label><input id="p_nueva" type="password" /></div>
    <button class="btn btn-primary btn-block" id="p_guardar">Guardar</button>
  `);
  $('#p_guardar').addEventListener('click', async () => {
    try {
      await api('/api/cambiar-password', { method: 'POST', body: { actual: $('#p_actual').value, nueva: $('#p_nueva').value } });
      toast('Contraseña actualizada');
      cerrarModal();
    } catch (e) { toast(e.message); }
  });
}

// ===========================================================================
// NAVEGACIÓN / MODAL
// ===========================================================================
function irA(view) {
  if (view === 'reportes' && sesion.rol !== 'master') view = 'catalogo';
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#view-' + view).classList.add('active');
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  if (view === 'catalogo') cargarCatalogo();
  if (view === 'reportes') cargarReportes();
  if (view !== 'escanear') detenerEscaner();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => irA(t.dataset.view)));

function abrirModal(titulo, htmlBody) {
  $('#modalTitle').textContent = titulo;
  $('#modalBody').innerHTML = htmlBody;
  $('#modal').hidden = false;
}
function cerrarModal() { $('#modal').hidden = true; }
$('#modalClose').addEventListener('click', cerrarModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });

// ===========================================================================
// CATÁLOGO
// ===========================================================================
async function cargarCatalogo(q = '') {
  try {
    const arts = await api('/api/articulos' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const cont = $('#listaCatalogo');
    if (!arts.length) {
      cont.innerHTML = `<p class="hint">Aún no hay artículos.${sesion.rol === 'master' ? ' Usa “+ Nuevo artículo” para empezar.' : ''}</p>`;
      return;
    }
    cont.innerHTML = arts.map(cardArticulo).join('');
    $$('[data-etiqueta]', cont).forEach((b) => b.addEventListener('click', () => imprimirEtiqueta(arts.find((a) => a.id == b.dataset.etiqueta))));
    $$('[data-editar]', cont).forEach((b) => b.addEventListener('click', () => formArticulo(arts.find((a) => a.id == b.dataset.editar))));
  } catch (e) { toast(e.message); }
}

function cardArticulo(a) {
  const low = a.stock <= a.stock_minimo;
  const detalles = [a.categoria, a.talla, a.color].filter(Boolean).join(' · ');
  const esMaster = sesion && sesion.rol === 'master';
  return `
    <div class="card">
      ${a.imagen ? `<div class="card-foto"><img src="${a.imagen}" alt="${escapeAttr(a.nombre)}" loading="lazy" /></div>` : ''}
      <div class="info">
        <div class="nombre">${escapeHtml(a.nombre)}</div>
        <div class="sku">${a.sku}${a.codigo_propio ? ' · código propio' : ''}</div>
        ${detalles ? `<div class="meta">${escapeHtml(detalles)}</div>` : ''}
        <div style="margin-top:8px;display:flex;gap:6px">
          <button class="btn btn-sm" data-etiqueta="${a.id}">Etiqueta</button>
          ${esMaster ? `<button class="btn btn-sm btn-ghost" data-editar="${a.id}">Editar</button>` : ''}
        </div>
      </div>
      <div class="right">
        <span class="stock-pill ${low ? 'low' : ''}">${a.stock} en stock</span>
        <span class="precio">${money(a.precio)}</span>
      </div>
    </div>`;
}

$('#buscarCatalogo').addEventListener('input', (e) => {
  clearTimeout($('#buscarCatalogo')._t);
  $('#buscarCatalogo')._t = setTimeout(() => cargarCatalogo(e.target.value), 250);
});
$('#btnNuevo').addEventListener('click', () => formArticulo());

function formArticulo(art = null) {
  const esNuevo = !art;
  // Imagen actual del artículo (Data URL). Se actualiza al elegir/quitar foto.
  let imagenActual = art && art.imagen ? art.imagen : null;
  abrirModal(esNuevo ? 'Nuevo artículo' : 'Editar artículo', `
    <div class="field"><label>Foto del artículo</label>
      <div class="img-uploader">
        <div id="f_img_preview" class="img-preview ${imagenActual ? 'con-img' : ''}">
          ${imagenActual ? `<img src="${imagenActual}" alt="" />` : '<span>Sin foto</span>'}
        </div>
        <div class="img-uploader-acciones">
          <label class="btn btn-sm" for="f_imagen">${imagenActual ? 'Cambiar foto' : 'Subir foto'}</label>
          <input id="f_imagen" type="file" accept="image/*" hidden />
          <button type="button" class="btn btn-sm btn-ghost" id="f_img_quitar" style="${imagenActual ? '' : 'display:none'}">Quitar</button>
        </div>
      </div>
    </div>
    <div class="field"><label>Nombre *</label><input id="f_nombre" value="${art ? escapeAttr(art.nombre) : ''}" placeholder="Ej. Blusa lino manga larga" /></div>
    <div class="field-row">
      <div class="field"><label>Categoría</label><input id="f_categoria" value="${art ? escapeAttr(art.categoria || '') : ''}" /></div>
      <div class="field"><label>Precio</label><input id="f_precio" type="number" step="0.01" value="${art ? art.precio : ''}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Talla</label><input id="f_talla" value="${art ? escapeAttr(art.talla || '') : ''}" /></div>
      <div class="field"><label>Color</label><input id="f_color" value="${art ? escapeAttr(art.color || '') : ''}" /></div>
    </div>
    ${esNuevo ? `
    <div class="field-row">
      <div class="field"><label>Stock inicial</label><input id="f_stock" type="number" value="0" /></div>
      <div class="field"><label>Stock mínimo</label><input id="f_min" type="number" value="3" /></div>
    </div>
    <div class="field"><label>Código de barras</label>
      <input id="f_sku" placeholder="Escanéalo o déjalo vacío para generar uno" />
    </div>` : `
    <div class="field"><label>Stock mínimo</label><input id="f_min" type="number" value="${art.stock_minimo}" /></div>`}
    <button class="btn btn-primary btn-block" id="f_guardar">${esNuevo ? 'Crear artículo' : 'Guardar cambios'}</button>
  `);

  // --- Manejo de la foto ---
  function pintarPreview() {
    const box = $('#f_img_preview');
    box.classList.toggle('con-img', !!imagenActual);
    box.innerHTML = imagenActual ? `<img src="${imagenActual}" alt="" />` : '<span>Sin foto</span>';
    $('#f_img_quitar').style.display = imagenActual ? '' : 'none';
    $('[for="f_imagen"]').textContent = imagenActual ? 'Cambiar foto' : 'Subir foto';
  }
  $('#f_imagen').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try { imagenActual = await comprimirImagen(file); pintarPreview(); }
    catch (_) { toast('No se pudo procesar la imagen'); }
    e.target.value = '';
  });
  $('#f_img_quitar').addEventListener('click', () => { imagenActual = null; pintarPreview(); });

  $('#f_guardar').addEventListener('click', async () => {
    const nombre = $('#f_nombre').value.trim();
    if (!nombre) return toast('El nombre es obligatorio');
    try {
      if (esNuevo) {
        const nuevo = await api('/api/articulos', { method: 'POST', body: {
          nombre, categoria: $('#f_categoria').value.trim(), precio: $('#f_precio').value,
          talla: $('#f_talla').value.trim(), color: $('#f_color').value.trim(),
          stock: $('#f_stock').value, stock_minimo: $('#f_min').value, sku: $('#f_sku').value.trim(),
          imagen: imagenActual,
        } });
        toast('Creado: ' + nuevo.sku);
      } else {
        await api('/api/articulos/' + art.id, { method: 'PUT', body: {
          nombre, categoria: $('#f_categoria').value.trim(), precio: $('#f_precio').value,
          talla: $('#f_talla').value.trim(), color: $('#f_color').value.trim(), stock_minimo: $('#f_min').value,
          imagen: imagenActual,
        } });
        toast('Guardado');
      }
      cerrarModal(); cargarCatalogo();
    } catch (e) { toast(e.message); }
  });
}

// Comprime y redimensiona una imagen en el navegador antes de subirla, para
// que el base64 quede liviano (máx. 640px, JPEG). Devuelve un Data URL.
function comprimirImagen(file, maxLado = 640, calidad = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > height && width > maxLado) { height = Math.round(height * maxLado / width); width = maxLado; }
      else if (height > maxLado) { width = Math.round(width * maxLado / height); height = maxLado; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', calidad));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagen inválida')); };
    img.src = url;
  });
}

// ===========================================================================
// ESCÁNER
// ===========================================================================
let html5qr = null;
let modoEscaneo = 'barras'; // 'barras' | 'qr'

// Formatos según el modo elegido. Restringir los formatos mejora mucho la
// fiabilidad: en "barras" solo busca códigos 1D; en "qr" solo códigos QR.
function formatosSoportados(modo) {
  const F = window.Html5QrcodeSupportedFormats;
  if (!F) return undefined;
  if (modo === 'qr') return [F.QR_CODE];
  return [
    F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8,
    F.UPC_A, F.UPC_E, F.ITF,
  ];
}

async function iniciarEscaner() {
  if (html5qr) return;

  // La cámara solo funciona en contexto seguro (https:// o localhost).
  if (!window.isSecureContext) {
    toast('La cámara necesita HTTPS. Abre la app por https:// o localhost.');
    return;
  }

  html5qr = new Html5Qrcode('reader', {
    formatsToSupport: formatosSoportados(modoEscaneo),
    // Usa el BarcodeDetector nativo del navegador cuando existe:
    // es mucho más rápido y fiable leyendo códigos de barras 1D.
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    verbose: false,
  });

  // La zona de escaneo se adapta al modo: ancha y baja para códigos de
  // barras, cuadrada para códigos QR.
  const esQR = modoEscaneo === 'qr';
  const config = {
    fps: 15,
    qrbox: (anchoVideo, altoVideo) => {
      const base = Math.floor(Math.min(anchoVideo, altoVideo) * 0.9);
      return esQR
        ? { width: base, height: base }
        : { width: base, height: Math.max(90, Math.floor(base * 0.5)) };
    },
    aspectRatio: 1.333,
  };

  try {
    await html5qr.start({ facingMode: 'environment' }, config,
      (texto) => onEscaneo(texto), () => {});
    $('#scanner').classList.add('activo');
    $('#btnScanStart').disabled = true; $('#btnScanStop').disabled = false;
  } catch (e) { toast('No se pudo abrir la cámara: ' + e); html5qr = null; }
}
async function detenerEscaner() {
  if (html5qr) {
    try { await html5qr.stop(); await html5qr.clear(); } catch (_) {}
    html5qr = null; $('#btnScanStart').disabled = false; $('#btnScanStop').disabled = true;
  }
  const sc = $('#scanner'); if (sc) sc.classList.remove('activo', 'detectado');
}
$('#btnScanStart').addEventListener('click', iniciarEscaner);
$('#btnScanStop').addEventListener('click', detenerEscaner);

// Selector de modo: código de barras vs. QR.
$$('.scan-mode').forEach((btn) => btn.addEventListener('click', async () => {
  const nuevo = btn.dataset.modo;
  if (nuevo === modoEscaneo) return;
  modoEscaneo = nuevo;
  $$('.scan-mode').forEach((b) => b.classList.toggle('active', b === btn));
  // Si la cámara está encendida, reiníciala con el nuevo modo.
  if (html5qr) { await detenerEscaner(); await iniciarEscaner(); }
}));
$('#btnBuscarSku').addEventListener('click', () => { const v = $('#skuManual').value.trim(); if (v) onEscaneo(v); });

let ultimoEscaneo = { sku: '', t: 0 };
async function onEscaneo(sku) {
  const ahora = Date.now();
  if (sku === ultimoEscaneo.sku && ahora - ultimoEscaneo.t < 2500) return;
  ultimoEscaneo = { sku, t: ahora };
  // No abrir un nuevo resultado si ya hay una ventana emergente abierta.
  if (!$('#modal').hidden) return;
  if (navigator.vibrate) navigator.vibrate(60);
  const sc = $('#scanner');
  if (sc) { sc.classList.add('detectado'); setTimeout(() => sc.classList.remove('detectado'), 700); }
  try {
    const art = await api('/api/articulos/sku/' + encodeURIComponent(sku));
    modalArticuloEscaneado(art);
  } catch (e) {
    modalCodigoNoRegistrado(sku);
  }
}

// Ventana emergente cuando el código SÍ está registrado: muestra el artículo
// y las acciones disponibles según el rol (añadir a venta, entrada/salida).
function modalArticuloEscaneado(a) {
  const low = a.stock <= a.stock_minimo;
  const esMaster = sesion.rol === 'master';
  abrirModal('Artículo encontrado', `
    <div class="card" style="box-shadow:none;border:0;padding:0;margin-bottom:6px">
      ${a.imagen ? `<div class="card-foto" style="width:64px;height:64px"><img src="${a.imagen}" alt="${escapeAttr(a.nombre)}" /></div>` : ''}
      <div class="info">
        <div class="nombre">${escapeHtml(a.nombre)}</div>
        <div class="sku">${a.sku}</div>
        <div class="meta">${[a.categoria, a.talla, a.color].filter(Boolean).map(escapeHtml).join(' · ')}</div>
        <div style="margin-top:6px"><span class="stock-pill ${low ? 'low' : ''}">${a.stock} en stock</span> · ${money(a.precio)}</div>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="scanAVenta" style="margin-top:12px">Agregar a venta</button>
    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      ${esMaster ? `<button class="btn btn-sm" data-mov="entrada">+ Entrada</button>` : ''}
      <button class="btn btn-sm" data-mov="salida">− Salida</button>
    </div>
  `);
  $$('[data-mov]').forEach((b) => b.addEventListener('click', () => movimientoRapido(a, b.dataset.mov)));
  $('#scanAVenta').addEventListener('click', () => { agregarAVenta(a); toast('Agregado a venta'); cerrarModal(); });
}

// Ventana emergente cuando el código NO está registrado.
function modalCodigoNoRegistrado(sku) {
  const puedeAlta = sesion.rol === 'master';
  abrirModal('Código no registrado', `
    <p class="hint">El código <strong>${escapeHtml(sku)}</strong> no está en el catálogo.</p>
    ${puedeAlta
      ? `<button class="btn btn-primary btn-block" id="btnAltaScan" style="margin-top:12px">Registrar producto nuevo</button>`
      : `<p class="hint" style="margin-top:8px">Pídele al administrador que lo dé de alta.</p>
         <button class="btn btn-block" id="btnCerrarNoReg" style="margin-top:10px">Entendido</button>`}
  `);
  if (puedeAlta) {
    $('#btnAltaScan').addEventListener('click', () => {
      cerrarModal();
      formArticulo();
      setTimeout(() => { const el = $('#f_sku'); if (el) el.value = sku; }, 30);
    });
  } else {
    $('#btnCerrarNoReg').addEventListener('click', cerrarModal);
  }
}

async function movimientoRapido(art, tipo) {
  const cant = parseInt(prompt(`Cantidad de ${tipo}:`, '1'), 10);
  if (!cant || cant < 1) return;
  try {
    const actualizado = await api('/api/movimientos', { method: 'POST', body: { articulo_id: art.id, tipo, cantidad: cant } });
    toast(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada · stock: ${actualizado.stock}`);
    modalArticuloEscaneado(actualizado); // refresca la ventana con el stock nuevo
  } catch (e) { toast(e.message); }
}

// ===========================================================================
// VENTA / TICKET
// ===========================================================================
let carrito = [];
function agregarAVenta(art) {
  const ex = carrito.find((l) => l.id === art.id);
  if (ex) ex.cantidad++;
  else carrito.push({ id: art.id, sku: art.sku, nombre: art.nombre, precio: art.precio, cantidad: 1 });
  renderCarrito();
}
async function agregarPorSku(sku) {
  try { agregarAVenta(await api('/api/articulos/sku/' + encodeURIComponent(sku))); }
  catch (e) { toast(e.message); }
}
$('#btnVentaAgregar').addEventListener('click', () => { const v = $('#ventaSku').value.trim(); if (v) { agregarPorSku(v); $('#ventaSku').value = ''; } });
$('#ventaSku').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnVentaAgregar').click(); });

function renderCarrito() {
  const cont = $('#carrito');
  if (!carrito.length) cont.innerHTML = `<p class="hint">Sin artículos todavía.</p>`;
  else {
    cont.innerHTML = carrito.map((l, i) => `
      <div class="linea">
        <div class="info"><div class="nombre">${escapeHtml(l.nombre)}</div><div class="sku">${l.sku} · ${money(l.precio)}</div></div>
        <div class="qty"><button data-menos="${i}">−</button><span>${l.cantidad}</span><button data-mas="${i}">+</button></div>
        <strong>${money(l.precio * l.cantidad)}</strong>
      </div>`).join('');
    $$('[data-mas]', cont).forEach((b) => b.addEventListener('click', () => { carrito[b.dataset.mas].cantidad++; renderCarrito(); }));
    $$('[data-menos]', cont).forEach((b) => b.addEventListener('click', () => {
      const i = b.dataset.menos; carrito[i].cantidad--;
      if (carrito[i].cantidad <= 0) carrito.splice(i, 1); renderCarrito();
    }));
  }
  const total = carrito.reduce((s, l) => s + l.precio * l.cantidad, 0);
  $('#ventaTotal').textContent = money(total);
  $('#btnGenerarTicket').disabled = carrito.length === 0;
}

$('#btnGenerarTicket').addEventListener('click', async () => {
  try {
    const cliente = $('#ventaCliente').value.trim();
    const ticket = await api('/api/tickets', { method: 'POST', body: {
      items: carrito.map((l) => ({ articulo_id: l.id, cantidad: l.cantidad })),
      cliente,
    } });
    carrito = []; renderCarrito(); $('#ventaCliente').value = ''; mostrarTicket(ticket);
  } catch (e) { toast(e.message); }
});

function ticketHTML(ticket) {
  const filas = ticket.articulos.map((a) => `<tr><td>${a.cantidad}×</td><td>${escapeHtml(a.nombre)}</td><td style="text-align:right">${money(a.subtotal)}</td></tr>`).join('');
  return `
    <h4>Closet Sully</h4>
    <div class="pt-meta">Folio ${ticket.folio}<br>${new Date().toLocaleString('es-MX')}${ticket.cliente ? `<br>Cliente: ${escapeHtml(ticket.cliente)}` : ''}<br>Atendió: ${escapeHtml(ticket.usuario || sesion.nombre)}</div>
    <table><tbody>${filas}</tbody></table>
    <div class="pt-total"><span>Total</span><span>${money(ticket.total)}</span></div>
    <div class="pt-foot">¡Gracias por tu compra!</div>`;
}
function mostrarTicket(ticket) {
  abrirModal('Ticket ' + ticket.folio, `
    <div class="print-ticket" style="border:1px solid var(--line);border-radius:10px;margin-bottom:14px">${ticketHTML(ticket)}</div>
    <button class="btn btn-primary btn-block" id="btnPdfTicket">Descargar PDF</button>
    <button class="btn btn-block btn-ghost" id="btnImprimirTicket" style="margin-top:8px">Imprimir ticket</button>`);
  $('#btnImprimirTicket').addEventListener('click', () => { $('#printArea').innerHTML = `<div class="print-ticket">${ticketHTML(ticket)}</div>`; window.print(); });
  $('#btnPdfTicket').addEventListener('click', () => descargarTicketPdf(ticket.folio));
}

// Descarga el PDF del ticket. Se pide con el token (fetch → blob) para que el
// endpoint siga protegido y luego se abre/guarda el archivo.
async function descargarTicketPdf(folio) {
  try {
    const res = await fetch('/api/tickets/' + encodeURIComponent(folio) + '/pdf', {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!res.ok) throw new Error('No se pudo generar el PDF');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ticket-${folio}.pdf`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast(e.message); }
}

// ===========================================================================
// IMPRESIÓN DE ETIQUETA
// ===========================================================================
function imprimirEtiqueta(art) {
  $('#printArea').innerHTML = `
    <div class="print-label">
      <div class="pl-nombre">${escapeHtml(art.nombre)}</div>
      <img src="/api/articulos/${art.id}/barcode.png" alt="código" />
      <div class="pl-precio">${money(art.precio)}</div>
    </div>`;
  const img = $('#printArea img');
  img.onload = () => window.print();
  img.onerror = () => toast('No se pudo cargar el código');
}

// ===========================================================================
// REPORTES (solo master)
// ===========================================================================
async function cargarReportes() {
  if (sesion.rol !== 'master') return;
  try {
    const r = await api('/api/reportes/stock');
    $('#reporteResumen').innerHTML = `
      <div class="stat"><div class="n">${r.total_skus}</div><div class="l">Artículos (SKU)</div></div>
      <div class="stat"><div class="n">${r.unidades}</div><div class="l">Unidades en stock</div></div>
      <div class="stat"><div class="n">${money(r.valor)}</div><div class="l">Valor de inventario</div></div>`;

    const tickets = await api('/api/tickets');
    $('#reporteTickets').innerHTML = tickets.length ? tickets.slice(0, 30).map((t) => `
      <div class="mov">
        <span><strong>${t.folio}</strong>${t.cliente ? ' · ' + escapeHtml(t.cliente) : ''} <span class="sku">${escapeHtml(t.usuario || '—')}</span></span>
        <span>${money(t.total)} <button class="btn btn-sm btn-ghost" data-pdf="${escapeAttr(t.folio)}" style="margin-left:6px">PDF</button></span>
      </div>`).join('')
      : `<p class="hint">Sin tickets aún.</p>`;
    $$('[data-pdf]').forEach((b) => b.addEventListener('click', () => descargarTicketPdf(b.dataset.pdf)));

    $('#reporteBajo').innerHTML = r.bajo_stock.length ? r.bajo_stock.map(cardArticulo).join('') : `<p class="hint">Todo con stock suficiente. 🎉</p>`;

    const movs = await api('/api/movimientos');
    $('#reporteMovs').innerHTML = movs.slice(0, 40).map((m) => `
      <div class="mov">
        <span>${escapeHtml(m.nombre)} <span class="sku">${m.sku}</span> · ${escapeHtml(m.usuario || '—')}</span>
        <span class="t-${m.tipo}">${m.tipo === 'entrada' ? '+' : m.tipo === 'salida' ? '−' : '±'}${m.cantidad}</span>
      </div>`).join('') || `<p class="hint">Sin movimientos aún.</p>`;

    cargarUsuarios();
  } catch (e) { toast(e.message); }
}

async function cargarUsuarios() {
  try {
    const us = await api('/api/usuarios');
    $('#listaUsuarios').innerHTML = us.map((u) => `
      <div class="mov">
        <span>${escapeHtml(u.nombre)} <span class="sku">@${u.usuario}</span> · ${u.rol === 'master' ? 'Maestro' : 'Vendedor'}${u.activo ? '' : ' · inactivo'}</span>
        ${u.usuario !== sesion.usuario ? `<button class="btn btn-sm btn-ghost" data-toggle="${u.id}" data-activo="${u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button>` : '<span class="sku">tú</span>'}
      </div>`).join('');
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/api/usuarios/' + b.dataset.toggle, { method: 'PATCH', body: { activo: b.dataset.activo == '1' ? 0 : 1 } }); cargarUsuarios(); }
      catch (e) { toast(e.message); }
    }));
  } catch (e) { toast(e.message); }
}

$('#btnNuevoUsuario').addEventListener('click', () => {
  abrirModal('Nuevo usuario', `
    <div class="field"><label>Nombre visible</label><input id="u_nombre" placeholder="Ej. María López" /></div>
    <div class="field"><label>Usuario (acceso)</label><input id="u_usuario" placeholder="ej. maria" autocomplete="off" /></div>
    <div class="field"><label>Contraseña (mín. 6)</label><input id="u_password" type="password" /></div>
    <div class="field"><label>Rol</label>
      <select id="u_rol"><option value="vendedor">Vendedor (solo descuenta)</option><option value="master">Maestro (control total)</option></select>
    </div>
    <button class="btn btn-primary btn-block" id="u_guardar">Crear usuario</button>
  `);
  $('#u_guardar').addEventListener('click', async () => {
    try {
      await api('/api/usuarios', { method: 'POST', body: {
        nombre: $('#u_nombre').value.trim(), usuario: $('#u_usuario').value.trim(),
        password: $('#u_password').value, rol: $('#u_rol').value,
      } });
      toast('Usuario creado'); cerrarModal(); cargarUsuarios();
    } catch (e) { toast(e.message); }
  });
});

// ---- utilidades ------------------------------------------------------------
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Arranque
iniciarApp();

// server.js — API REST + servidor de la PWA para Closet Sully (con roles).
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bwipjs = require('bwip-js');
const PDFDocument = require('pdfkit');
const { db, generarSkuPropio, hashPassword, verifyPassword } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '6mb' })); // holgura para imágenes en base64
app.use(express.static(path.join(__dirname, 'public')));

// ===========================================================================
// AUTENTICACIÓN Y ROLES
// ===========================================================================
// Sesiones en memoria: token -> { id, usuario, nombre, rol }.
// (Al reiniciar el servidor, los usuarios vuelven a iniciar sesión.)
const sesiones = new Map();
const nuevoToken = () => crypto.randomBytes(24).toString('hex');

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = token && sesiones.get(token);
  if (!s) return res.status(401).json({ error: 'Sesión no válida. Inicia sesión de nuevo.' });
  req.user = s;
  req.token = token;
  next();
}
function soloMaster(req, res, next) {
  if (req.user.rol !== 'master') {
    return res.status(403).json({ error: 'Esta acción requiere permiso de administrador.' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get((usuario || '').trim());
  if (!u || !verifyPassword(password || '', u.password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  const token = nuevoToken();
  const datos = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
  sesiones.set(token, datos);
  res.json({ token, usuario: datos });
});

app.get('/api/me', auth, (req, res) => res.json({ usuario: req.user }));

app.post('/api/logout', auth, (req, res) => {
  sesiones.delete(req.token);
  res.json({ ok: true });
});

app.post('/api/cambiar-password', auth, (req, res) => {
  const { actual, nueva } = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  if (!verifyPassword(actual || '', u.password)) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  }
  if (!nueva || nueva.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  }
  db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hashPassword(nueva), u.id);
  res.json({ ok: true });
});

// --- Gestión de usuarios (solo master) -------------------------------------
app.get('/api/usuarios', auth, soloMaster, (req, res) => {
  const rows = db.prepare('SELECT id, usuario, nombre, rol, activo, creado_en FROM usuarios ORDER BY rol, nombre').all();
  res.json(rows);
});

app.post('/api/usuarios', auth, soloMaster, (req, res) => {
  const { usuario, nombre, password, rol } = req.body || {};
  if (!usuario || !nombre || !password) {
    return res.status(400).json({ error: 'Usuario, nombre y contraseña son obligatorios.' });
  }
  if (!['master', 'vendedor'].includes(rol)) {
    return res.status(400).json({ error: 'Rol no válido.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  const existe = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario.trim());
  if (existe) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de acceso.' });
  const info = db.prepare('INSERT INTO usuarios (usuario, nombre, password, rol) VALUES (?, ?, ?, ?)')
    .run(usuario.trim(), nombre.trim(), hashPassword(password), rol);
  res.status(201).json({ id: info.lastInsertRowid, usuario: usuario.trim(), nombre: nombre.trim(), rol, activo: 1 });
});

// Activar/desactivar un usuario (no se borra, para conservar historial)
app.patch('/api/usuarios/:id', auth, soloMaster, (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
  const activo = req.body.activo ? 1 : 0;
  db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(activo, u.id);
  res.json({ id: u.id, activo });
});

// ===========================================================================
// ARTÍCULOS
// ===========================================================================
function generarFolio() {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  const d = String(hoy.getDate()).padStart(2, '0');
  const prefijo = `CS-${y}${m}${d}`;
  const row = db.prepare(`SELECT folio FROM tickets WHERE folio LIKE ? ORDER BY folio DESC LIMIT 1`).get(prefijo + '%');
  let n = 1;
  if (row) n = parseInt(row.folio.slice(-4), 10) + 1;
  return `${prefijo}-${String(n).padStart(4, '0')}`;
}

// Listar / buscar (ambos roles)
app.get('/api/articulos', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = db.prepare(
      `SELECT * FROM articulos WHERE nombre LIKE ? OR sku LIKE ? OR categoria LIKE ? ORDER BY nombre`
    ).all(like, like, like);
  } else {
    rows = db.prepare(`SELECT * FROM articulos ORDER BY nombre`).all();
  }
  res.json(rows);
});

// Buscar por SKU exacto (ambos roles — lo usa el escáner)
app.get('/api/articulos/sku/:sku', auth, (req, res) => {
  const row = db.prepare(`SELECT * FROM articulos WHERE sku = ?`).get(req.params.sku);
  if (!row) return res.status(404).json({ error: 'Artículo no encontrado', sku: req.params.sku });
  res.json(row);
});

// Valida una imagen recibida como Data URL (base64). Devuelve la cadena si es
// válida, null si viene vacía, o lanza un error si no es una imagen admitida.
// La foto ya llega comprimida desde el navegador; el tope evita abusos.
const MAX_IMAGEN_BYTES = 3 * 1024 * 1024; // ~3 MB de imagen ya comprimida
function limpiarImagen(valor) {
  if (valor == null || valor === '') return null;
  const s = String(valor);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(s)) {
    throw new Error('Formato de imagen no válido');
  }
  if (s.length > MAX_IMAGEN_BYTES) throw new Error('La imagen es demasiado grande');
  return s;
}

// Alta de artículo (SOLO MASTER)
app.post('/api/articulos', auth, soloMaster, (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  let sku = (b.sku || '').trim();
  let codigoPropio = 0;
  if (!sku) { sku = generarSkuPropio(); codigoPropio = 1; }
  const existe = db.prepare(`SELECT id FROM articulos WHERE sku = ?`).get(sku);
  if (existe) return res.status(409).json({ error: 'Ya existe un artículo con ese código', sku });

  let imagen;
  try { imagen = limpiarImagen(b.imagen); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const info = db.prepare(
    `INSERT INTO articulos (sku, codigo_propio, nombre, categoria, talla, color, precio, stock, stock_minimo, imagen)
     VALUES (@sku, @codigo_propio, @nombre, @categoria, @talla, @color, @precio, @stock, @stock_minimo, @imagen)`
  ).run({
    sku, codigo_propio: codigoPropio, nombre: b.nombre.trim(),
    categoria: b.categoria || null, talla: b.talla || null, color: b.color || null,
    precio: Number(b.precio) || 0, stock: Number(b.stock) || 0,
    stock_minimo: b.stock_minimo != null ? Number(b.stock_minimo) : 3,
    imagen,
  });

  if (Number(b.stock) > 0) {
    db.prepare(
      `INSERT INTO movimientos (articulo_id, tipo, cantidad, usuario_id, usuario, nota)
       VALUES (?, 'entrada', ?, ?, ?, 'Stock inicial')`
    ).run(info.lastInsertRowid, Number(b.stock), req.user.id, req.user.nombre);
  }
  res.status(201).json(db.prepare(`SELECT * FROM articulos WHERE id = ?`).get(info.lastInsertRowid));
});

// Editar artículo (SOLO MASTER)
app.put('/api/articulos/:id', auth, soloMaster, (req, res) => {
  const art = db.prepare(`SELECT * FROM articulos WHERE id = ?`).get(req.params.id);
  if (!art) return res.status(404).json({ error: 'Artículo no encontrado' });
  const b = req.body || {};

  // Imagen: si no viene la clave, se conserva la actual; '' o null la borra;
  // una nueva Data URL la reemplaza.
  let imagen = art.imagen;
  if ('imagen' in b) {
    try { imagen = limpiarImagen(b.imagen); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }

  db.prepare(
    `UPDATE articulos SET nombre=@nombre, categoria=@categoria, talla=@talla,
       color=@color, precio=@precio, stock_minimo=@stock_minimo, imagen=@imagen WHERE id=@id`
  ).run({
    id: art.id, nombre: b.nombre ?? art.nombre, categoria: b.categoria ?? art.categoria,
    talla: b.talla ?? art.talla, color: b.color ?? art.color,
    precio: b.precio != null ? Number(b.precio) : art.precio,
    stock_minimo: b.stock_minimo != null ? Number(b.stock_minimo) : art.stock_minimo,
    imagen,
  });
  res.json(db.prepare(`SELECT * FROM articulos WHERE id = ?`).get(art.id));
});

// Imagen de código de barras (pública: no expone datos sensibles, y <img> no puede
// enviar cabecera de autorización). Solo dibuja el código Code128 del SKU.
app.get('/api/articulos/:id/barcode.png', async (req, res) => {
  const art = db.prepare(`SELECT * FROM articulos WHERE id = ?`).get(req.params.id);
  if (!art) return res.status(404).send('No encontrado');
  try {
    const png = await bwipjs.toBuffer({
      bcid: 'code128', text: art.sku, scale: 3, height: 12, includetext: true, textxalign: 'center',
    });
    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(500).send('Error generando código: ' + e.message);
  }
});

// ===========================================================================
// MOVIMIENTOS
// ===========================================================================
const registrarMovimiento = db.transaction((articuloId, tipo, cantidad, user, ticketFolio, nota) => {
  const art = db.prepare(`SELECT * FROM articulos WHERE id = ?`).get(articuloId);
  if (!art) throw new Error('Artículo no encontrado');
  let delta = 0;
  if (tipo === 'entrada') delta = cantidad;
  else if (tipo === 'salida') delta = -cantidad;
  else if (tipo === 'ajuste') delta = cantidad;
  const nuevoStock = art.stock + delta;
  if (nuevoStock < 0) throw new Error(`Stock insuficiente de "${art.nombre}" (hay ${art.stock})`);
  db.prepare(`UPDATE articulos SET stock = ? WHERE id = ?`).run(nuevoStock, art.id);
  db.prepare(
    `INSERT INTO movimientos (articulo_id, tipo, cantidad, usuario_id, usuario, ticket_folio, nota)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(art.id, tipo, cantidad, user.id, user.nombre, ticketFolio || null, nota || null);
  return db.prepare(`SELECT * FROM articulos WHERE id = ?`).get(art.id);
});

// Registrar movimiento. 'salida' = ambos roles; 'entrada'/'ajuste' = solo master.
app.post('/api/movimientos', auth, (req, res) => {
  const { articulo_id, tipo, cantidad, nota } = req.body || {};
  if (!articulo_id || !tipo || !cantidad) {
    return res.status(400).json({ error: 'Faltan datos: articulo_id, tipo y cantidad' });
  }
  if (tipo !== 'salida' && req.user.rol !== 'master') {
    return res.status(403).json({ error: 'Solo el administrador puede registrar entradas o ajustes.' });
  }
  try {
    const art = registrarMovimiento(articulo_id, tipo, Number(cantidad), req.user, null, nota);
    res.status(201).json(art);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Historial de movimientos (SOLO MASTER — control interno)
app.get('/api/movimientos', auth, soloMaster, (req, res) => {
  const rows = db.prepare(
    `SELECT m.*, a.nombre, a.sku FROM movimientos m
     JOIN articulos a ON a.id = m.articulo_id ORDER BY m.id DESC LIMIT 200`
  ).all();
  res.json(rows);
});

// ===========================================================================
// TICKETS
// ===========================================================================
app.post('/api/tickets', auth, (req, res) => {
  const { items } = req.body || {};
  const cliente = (req.body && req.body.cliente ? String(req.body.cliente).trim() : '') || null;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'El ticket no tiene artículos' });
  }
  const folio = generarFolio();
  const crear = db.transaction(() => {
    let total = 0;
    const detalle = [];
    for (const it of items) {
      const art = db.prepare(`SELECT * FROM articulos WHERE id = ?`).get(it.articulo_id);
      if (!art) throw new Error('Artículo no encontrado (id ' + it.articulo_id + ')');
      const cant = Number(it.cantidad) || 1;
      registrarMovimiento(art.id, 'salida', cant, req.user, folio, 'Venta');
      const subtotal = art.precio * cant;
      total += subtotal;
      detalle.push({ sku: art.sku, nombre: art.nombre, cantidad: cant, precio: art.precio, subtotal });
    }
    db.prepare(
      `INSERT INTO tickets (folio, total, articulos, usuario_id, usuario, cliente) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(folio, total, JSON.stringify(detalle), req.user.id, req.user.nombre, cliente);
    return { folio, total, articulos: detalle, usuario: req.user.nombre, cliente };
  });
  try {
    res.status(201).json(crear());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Ver un ticket (ambos roles)
app.get('/api/tickets/:folio', auth, (req, res) => {
  const t = db.prepare(`SELECT * FROM tickets WHERE folio = ?`).get(req.params.folio);
  if (!t) return res.status(404).json({ error: 'Ticket no encontrado' });
  t.articulos = JSON.parse(t.articulos);
  res.json(t);
});

// Ticket en PDF descargable (ambos roles). Formato de recibo estrecho (80 mm).
app.get('/api/tickets/:folio/pdf', auth, (req, res) => {
  const t = db.prepare(`SELECT * FROM tickets WHERE folio = ?`).get(req.params.folio);
  if (!t) return res.status(404).json({ error: 'Ticket no encontrado' });
  const items = JSON.parse(t.articulos);

  const money = (n) => '$' + (Number(n) || 0).toFixed(2);
  const ancho = 226; // ~80 mm en puntos
  // Altura dinámica para que el recibo se ajuste al contenido (sin hoja vacía).
  const alto = 150 + items.length * 16 + (t.cliente ? 14 : 0) + 90;
  const doc = new PDFDocument({ size: [ancho, alto], margin: 16 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="ticket-${t.folio}.pdf"`);
  doc.pipe(res);

  const cont = ancho - 32; // ancho útil
  doc.font('Helvetica-Bold').fontSize(15).text('Closet Sully', { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text('Ticket de venta', { align: 'center' });
  doc.moveDown(0.6).fillColor('#000');

  doc.fontSize(8.5).fillColor('#333');
  doc.text(`Folio: ${t.folio}`);
  doc.text(`Fecha: ${new Date(t.creado_en || Date.now()).toLocaleString('es-MX')}`);
  if (t.cliente) doc.text(`Cliente: ${t.cliente}`);
  doc.text(`Atendió: ${t.usuario || '—'}`);
  doc.fillColor('#000').moveDown(0.5);

  // Línea separadora
  const linea = () => { doc.moveTo(16, doc.y).lineTo(16 + cont, doc.y).strokeColor('#ccc').stroke(); doc.moveDown(0.3); };
  linea();

  doc.fontSize(9);
  for (const a of items) {
    const izq = `${a.cantidad}x ${a.nombre}`;
    const der = money(a.subtotal);
    const y = doc.y;
    doc.font('Helvetica').text(izq, 16, y, { width: cont - 55 });
    doc.text(der, 16, y, { width: cont, align: 'right' });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.2); linea();

  const yT = doc.y;
  doc.font('Helvetica-Bold').fontSize(12).text('Total', 16, yT, { width: cont - 70 });
  doc.text(money(t.total), 16, yT, { width: cont, align: 'right' });

  doc.moveDown(1).font('Helvetica').fontSize(8.5).fillColor('#555')
    .text('¡Gracias por tu compra!', { align: 'center' });

  doc.end();
});

// Historial de tickets con nombre de quien descontó (SOLO MASTER)
app.get('/api/tickets', auth, soloMaster, (req, res) => {
  const rows = db.prepare(
    `SELECT folio, total, usuario, cliente, creado_en FROM tickets ORDER BY creado_en DESC LIMIT 100`
  ).all();
  res.json(rows);
});

// ===========================================================================
// REPORTES (SOLO MASTER)
// ===========================================================================
app.get('/api/reportes/stock', auth, soloMaster, (req, res) => {
  const total_skus = db.prepare(`SELECT COUNT(*) c FROM articulos`).get().c;
  const unidades = db.prepare(`SELECT COALESCE(SUM(stock),0) s FROM articulos`).get().s;
  const valor = db.prepare(`SELECT COALESCE(SUM(stock*precio),0) v FROM articulos`).get().v;
  const bajo_stock = db.prepare(`SELECT * FROM articulos WHERE stock <= stock_minimo ORDER BY stock ASC`).all();
  res.json({ total_skus, unidades, valor, bajo_stock });
});

app.listen(PORT, () => {
  console.log(`Closet Sully — inventario corriendo en http://localhost:${PORT}`);
});

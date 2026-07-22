// db.js — Capa de datos con SQLite (better-sqlite3) + usuarios/roles.
// SQLite es más que suficiente para 100–1,000 SKUs y no requiere un
// servidor de base de datos aparte: todo vive en el archivo closet-sully.db.

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const db = new Database(path.join(__dirname, 'closet-sully.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Esquema ---------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario    TEXT NOT NULL UNIQUE,          -- nombre de acceso (login)
    nombre     TEXT NOT NULL,                 -- nombre visible
    password   TEXT NOT NULL,                 -- salt:hash (scrypt)
    rol        TEXT NOT NULL CHECK (rol IN ('master','vendedor')),
    activo     INTEGER NOT NULL DEFAULT 1,
    creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS articulos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sku            TEXT NOT NULL UNIQUE,        -- código interno / código de barras
    codigo_propio  INTEGER NOT NULL DEFAULT 0, -- 1 si el sistema generó el código
    nombre         TEXT NOT NULL,
    categoria      TEXT,
    talla          TEXT,
    color          TEXT,
    precio         REAL NOT NULL DEFAULT 0,
    stock          INTEGER NOT NULL DEFAULT 0,
    stock_minimo   INTEGER NOT NULL DEFAULT 3,
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    articulo_id   INTEGER NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
    tipo          TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste')),
    cantidad      INTEGER NOT NULL,
    usuario_id    INTEGER REFERENCES usuarios(id),
    usuario       TEXT,                        -- nombre congelado de quien lo hizo
    ticket_folio  TEXT,
    nota          TEXT,
    creado_en     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    folio       TEXT PRIMARY KEY,
    total       REAL NOT NULL DEFAULT 0,
    articulos   TEXT NOT NULL,               -- JSON con el detalle congelado del ticket
    usuario_id  INTEGER REFERENCES usuarios(id),
    usuario     TEXT,                         -- nombre congelado de quien descontó
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_mov_articulo ON movimientos(articulo_id);
  CREATE INDEX IF NOT EXISTS idx_mov_ticket   ON movimientos(ticket_folio);
`);

// --- Migraciones ligeras ---------------------------------------------------
// Añade columnas nuevas a bases de datos ya existentes sin perder datos.
// La imagen se guarda como Data URL (base64) dentro de la propia BD, así el
// proyecto sigue siendo portable: funciona igual en Render o en cualquier host.
const colsArticulos = db.prepare(`PRAGMA table_info(articulos)`).all().map((c) => c.name);
if (!colsArticulos.includes('imagen')) {
  db.exec(`ALTER TABLE articulos ADD COLUMN imagen TEXT`);
}

// Nombre del cliente asociado a cada ticket de venta (opcional).
const colsTickets = db.prepare(`PRAGMA table_info(tickets)`).all().map((c) => c.name);
if (!colsTickets.includes('cliente')) {
  db.exec(`ALTER TABLE tickets ADD COLUMN cliente TEXT`);
}

// --- Contraseñas (scrypt, sin dependencias externas) -----------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch (_) {
    return false;
  }
}

// --- Usuario maestro por defecto (solo si no hay ninguno) -------------------
const totalUsuarios = db.prepare('SELECT COUNT(*) c FROM usuarios').get().c;
if (totalUsuarios === 0) {
  db.prepare('INSERT INTO usuarios (usuario, nombre, password, rol) VALUES (?, ?, ?, ?)')
    .run('master', 'Administrador', hashPassword('closet123'), 'master');
  console.log('──────────────────────────────────────────────');
  console.log(' Usuario maestro creado:');
  console.log('   usuario:    master');
  console.log('   contraseña: closet123   (cámbiala al entrar)');
  console.log('──────────────────────────────────────────────');
}

// --- Generación de código propio ------------------------------------------
// Para artículos sin código de barras existente, generamos un SKU interno
// correlativo con prefijo CS (Closet Sully): CS-000001, CS-000002, ...
function generarSkuPropio() {
  const row = db
    .prepare(`SELECT sku FROM articulos WHERE codigo_propio = 1 AND sku LIKE 'CS-%' ORDER BY id DESC LIMIT 1`)
    .get();
  let siguiente = 1;
  if (row) {
    const n = parseInt(row.sku.replace('CS-', ''), 10);
    if (!Number.isNaN(n)) siguiente = n + 1;
  }
  return 'CS-' + String(siguiente).padStart(6, '0');
}

module.exports = { db, generarSkuPropio, hashPassword, verifyPassword };

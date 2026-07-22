// seed.js — carga artículos de ejemplo para probar el sistema.
// Ejecuta: npm run seed
const { db, generarSkuPropio, hashPassword } = require('./db');

const ejemplos = [
  { nombre: 'Blusa lino manga larga', categoria: 'Blusas', talla: 'M', color: 'Blanco', precio: 389, stock: 8, sku: '7501234500011' },
  { nombre: 'Vestido midi floral', categoria: 'Vestidos', talla: 'S', color: 'Rosa', precio: 649, stock: 4, sku: '7501234500028' },
  { nombre: 'Jeans corte recto', categoria: 'Pantalones', talla: '30', color: 'Azul', precio: 559, stock: 2, sku: '7501234500035' },
  { nombre: 'Suéter tejido cuello alto', categoria: 'Suéteres', talla: 'L', color: 'Camel', precio: 499, stock: 6, sku: '' },
  { nombre: 'Falda plisada', categoria: 'Faldas', talla: 'M', color: 'Verde', precio: 429, stock: 1, sku: '' },
  { nombre: 'Bolsa de mano piel sintética', categoria: 'Accesorios', talla: 'Único', color: 'Negro', precio: 349, stock: 10, sku: '' },
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO articulos (sku, codigo_propio, nombre, categoria, talla, color, precio, stock, stock_minimo)
  VALUES (@sku, @codigo_propio, @nombre, @categoria, @talla, @color, @precio, @stock, 3)
`);

// Solo siembra artículos si la tabla está vacía, para que re-ejecutar
// `npm run seed` no genere duplicados (los artículos sin SKU generan uno
// nuevo en cada corrida).
const yaHayArticulos = db.prepare('SELECT COUNT(*) c FROM articulos').get().c > 0;

let n = 0;
for (const e of (yaHayArticulos ? [] : ejemplos)) {
  let sku = e.sku;
  let propio = 0;
  if (!sku) { sku = generarSkuPropio(); propio = 1; }
  const info = insert.run({ ...e, sku, codigo_propio: propio });
  if (info.changes) {
    db.prepare(`INSERT INTO movimientos (articulo_id, tipo, cantidad, usuario, nota) VALUES (?, 'entrada', ?, 'seed', 'Stock inicial')`)
      .run(info.lastInsertRowid, e.stock);
    n++;
  }
}
console.log(`Sembrados ${n} artículos de ejemplo.`);

// --- Usuario vendedor de demostración -------------------------------------
// Rol limitado: solo puede descontar stock (salidas y ventas), sin acceso
// a reportes, altas de artículos ni gestión de usuarios.
const vend = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get('vendedora');
if (!vend) {
  db.prepare('INSERT INTO usuarios (usuario, nombre, password, rol) VALUES (?, ?, ?, ?)')
    .run('vendedora', 'María (Vendedora)', hashPassword('ventas123'), 'vendedor');
  console.log('──────────────────────────────────────────────');
  console.log(' Usuario vendedor de demo creado:');
  console.log('   usuario:    vendedora');
  console.log('   contraseña: ventas123');
  console.log('──────────────────────────────────────────────');
}

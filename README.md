# Closet Sully · Sistema de Inventario

Sistema a la medida para controlar el inventario de **Closet Sully**: entradas y salidas de artículos, escaneo de código de barras con la cámara de una tablet o celular, generación de código propio para productos sin código, tickets de venta virtuales e impresión de etiquetas térmicas.

Es una **PWA** (aplicación web) con backend en Node.js y base de datos SQLite. Corre en cualquier dispositivo con navegador —tablet, celular o PC— sin instalar nada de tienda de apps.

---

## Requisitos

- **Node.js 18 o superior** (probado en Node 22). Descárgalo en https://nodejs.org
- Para escanear con la cámara: el sitio debe servirse por **HTTPS** o desde `localhost` (los navegadores solo dan acceso a la cámara en contextos seguros).

## Instalación y arranque

```bash
# 1. Entra a la carpeta del proyecto
cd closet-sully-inventario

# 2. Instala dependencias (solo la primera vez)
npm install

# 3. (Opcional) Carga artículos de ejemplo para probar
npm run seed

# 4. Arranca el sistema
npm start
```

Abre en el navegador: **http://localhost:3000**

La base de datos se crea sola en el archivo `closet-sully.db` la primera vez que arranca.

---

## Cómo se usa

La app tiene cuatro secciones (barra inferior):

- **Catálogo** — Alta de artículos, búsqueda, edición e impresión de etiquetas. Al crear un artículo puedes escanear su código de barras existente o dejar el campo vacío para que el sistema genere uno propio (`CS-000001`, `CS-000002`, …).
- **Escanear** — Enciende la cámara y apunta a un código. Si el artículo existe, muestra su información y botones para registrar **entrada** (+) o **salida** (−). Si el código no está registrado, ofrece darlo de alta con ese código.
- **Venta** — Arma una venta escaneando o tecleando códigos, ajusta cantidades y genera el **ticket**. Cada ticket descuenta el stock automáticamente y queda guardado con un folio (`CS-AAAAMMDD-0001`).
- **Reportes** — Total de artículos y unidades, valor del inventario, lista de bajo inventario y últimos movimientos.

El botón de la esquina superior derecha muestra tu cuenta, permite **cambiar tu contraseña** y **cerrar sesión**.

---

## Usuarios y roles (control interno)

El sistema tiene dos tipos de usuario:

| Acción | Maestro | Vendedor |
|---|---|---|
| Ver catálogo y stock | ✓ | ✓ |
| Escanear y **descontar** (salidas) | ✓ | ✓ |
| Generar tickets de venta | ✓ | ✓ |
| **Crear / editar artículos** | ✓ | — |
| **Registrar entradas** (reabastecer) | ✓ | — |
| Ver reportes, tickets y movimientos | ✓ | — |
| Crear y administrar usuarios | ✓ | — |

**Cada ticket y cada movimiento se registra automáticamente a nombre del usuario que tiene la sesión abierta** —el nombre no se teclea ni se puede falsear—. El usuario maestro ve, en la pestaña **Reportes**, la lista de tickets y movimientos con el nombre de quién descontó cada cosa.

### Primer acceso

Al arrancar por primera vez, el sistema crea un usuario maestro:

```
usuario:    master
contraseña: closet123
```

> **Cambia esta contraseña al entrar** (botón de tu cuenta → “Cambiar mi contraseña”). Desde **Reportes → Usuarios** el maestro crea las cuentas de las vendedoras (rol *Vendedor*) y puede desactivarlas sin borrar su historial.

Las contraseñas se guardan cifradas (scrypt); nunca se almacenan en texto plano. Las sesiones viven en memoria del servidor, así que al reiniciarlo los usuarios vuelven a iniciar sesión.

---

## Impresión térmica

El sistema genera dos formatos listos para impresora térmica; ambos se imprimen con el botón correspondiente en la app y usan el diálogo de impresión del navegador.

### Etiqueta de producto (código de barras + precio)
- Formato preparado para **50 × 30 mm**. Ajustable en `public/styles.css` (busca `.print-label`).
- El código de barras es **Code128** generado en el servidor.

### Ticket de venta
- Formato para papel de **58 mm**. Ajustable en `.print-ticket` dentro de `public/styles.css`.

### Insumos recomendados

**Impresora de etiquetas** (transferencia térmica directa, sin tinta ni tóner):
- Económica y común en México: **Xprinter XP-365B**.
- Robusta / alto volumen: **Zebra ZD230** o **GK420d**.

**Impresora de tickets** (recibos):
- **Epson TM-T20III** (confiable) o **POS-58** (económica).

**Consumibles:**
- Rollos de **etiqueta térmica directa** de 50×30 mm (verifica el diámetro del núcleo/core compatible con tu impresora, típico 1").
- Rollos de **papel térmico** de 58 mm para tickets.

**Conexión:** USB es lo más simple. Si quieres imprimir directo desde la tablet sin cable, elige un modelo con Bluetooth o WiFi.

> **Nota sobre impresión directa a impresora térmica:** el botón de imprimir usa el diálogo del navegador, que funciona bien cuando la impresora está instalada en el sistema (Windows/macOS/Android). Para impresión 100% automática desde el backend (sin diálogo), se puede integrar `ZPL` (Zebra) para etiquetas o la librería `escpos` para tickets — es la **Fase 4** del plan y se puede agregar cuando definas el modelo exacto de impresora.

---

## Estructura del proyecto

```
closet-sully-inventario/
├── server.js        API REST + sirve la PWA
├── db.js            Base de datos SQLite y esquema
├── seed.js          Datos de ejemplo (npm run seed)
├── package.json
└── public/          La aplicación (frontend)
    ├── index.html
    ├── styles.css   Identidad visual + estilos de impresión
    ├── app.js       Lógica: catálogo, escáner, venta, reportes
    ├── manifest.webmanifest
    └── sw.js        Service worker (arranque offline del shell)
```

## Base de datos

Cuatro tablas: `usuarios` (cuentas y roles, contraseña cifrada), `articulos` (catálogo y stock), `movimientos` (historial de entradas/salidas, con el usuario que lo hizo) y `tickets` (ventas con su detalle congelado y el usuario que descontó). Todo el stock se calcula a partir de movimientos, así que el historial siempre cuadra con las existencias.

Para respaldar tu información, basta con copiar el archivo `closet-sully.db`.

---

## Puesta en producción (para varios dispositivos en la tienda)

Para que las tablets/celulares de la tienda se conecten al mismo inventario, el sistema debe correr en un servidor accesible en red y con **HTTPS** (requisito de la cámara). Opciones:

1. **Una PC/mini-PC en la tienda** como servidor local, con las tablets en la misma red WiFi. Requiere configurar HTTPS local.
2. **Un VPS** (por ejemplo el de HostGator que evaluamos) con un dominio y certificado SSL — accesible desde cualquier lugar.

En ambos casos conviene poner el sistema detrás de un proxy (Nginx/Caddy) que maneje el certificado SSL, y usar un gestor de procesos como `pm2` para que arranque solo.

---

## Próximos pasos sugeridos (fases pendientes)

- Importación masiva del catálogo inicial por CSV (para cargar los 100–1,000 artículos de golpe).
- Impresión automática directa a impresora térmica (ZPL / ESC-POS).
- Reportes por rango de fechas y exportación a Excel (ej. ventas por vendedora en un periodo).
- Multi-sucursal / subempresas (si aplica a futuro).

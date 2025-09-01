const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

const app = express(); // <-- Primero declara app
const http = require('http').createServer(app); // <-- Luego usa app aquí
const { Server } = require('socket.io');
const io = new Server(http, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(cors()); // <-- Permite peticiones desde cualquier origen
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

const upload = multer({ storage: multer.memoryStorage() });

const pedidos = []; // Almacena los pedidos en memoria

// --- Ganancias en archivo local ---
const GANANCIAS_FILE = path.join(__dirname, 'ganancias.json');
let gananciasSemana = 0;

// Cargar ganancias desde archivo al iniciar
function cargarGanancias() {
    try {
        if (fs.existsSync(GANANCIAS_FILE)) {
            const data = fs.readFileSync(GANANCIAS_FILE, 'utf8');
            const obj = JSON.parse(data);
            gananciasSemana = typeof obj.ganancias === 'number' ? obj.ganancias : 0;
        }
    } catch (e) {
        gananciasSemana = 0;
    }
}
function guardarGanancias() {
    fs.writeFileSync(GANANCIAS_FILE, JSON.stringify({ ganancias: gananciasSemana }), 'utf8');
}
cargarGanancias();

// Endpoint para consultar ganancias
app.get('/ganancias', (req, res) => {
    res.json({ ganancias: gananciasSemana });
});

// Endpoint para reiniciar ganancias
app.post('/ganancias/reiniciar', (req, res) => {
    gananciasSemana = 0;
    guardarGanancias();
    res.json({ ok: true, ganancias: gananciasSemana });
});

// --- FIN ganancias local ---

app.post('/pedido', (req, res) => {
    const pedido = req.body;
    // Validar que al menos haya un producto con cantidad > 0
    const productos = Object.entries(pedido).filter(([key, val]) =>
        typeof val === 'object' && val !== null && val.cantidad > 0
    );
    if (productos.length === 0) {
        return res.status(400).json({ mensaje: 'Debes seleccionar al menos un producto.' });
    }
    pedidos.push(pedido); // Guarda el pedido en memoria

    // Sumar al total de ganancias
    let total = 0;
    if (typeof pedido.total === 'string') {
        total = parseFloat(pedido.total.replace(/[^0-9.]/g, '')) || 0;
    } else if (typeof pedido.total === 'number') {
        total = pedido.total;
    }
    gananciasSemana += total;
    guardarGanancias();

    io.emit('pedidoNuevo'); // Notifica a los clientes en tiempo real
    res.json({ mensaje: 'Pedido recibido. ¡Gracias!' });
});

// Ruta para ver todos los pedidos anotados
app.get('/pedidos', (req, res) => {
    res.json(pedidos);
});

app.delete('/pedidos/:idx', (req, res) => {
    const idx = parseInt(req.params.idx, 10);
    if (!isNaN(idx) && idx >= 0 && idx < pedidos.length) {
        pedidos.splice(idx, 1);
        io.emit('pedidoActualizado'); // Notifica a los clientes
        res.json({ mensaje: 'Pedido finalizado y eliminado' });
    } else {
        res.status(400).json({ error: 'Índice inválido' });
    }
});

const MONGO_URI = 'mongodb+srv://daniel:daniel25@so.k6u9iol.mongodb.net/?retryWrites=true&w=majority&appName=so&authSource=admin';
const DB_NAME = 'so';
const MENU_COLLECTION = 'menu';

let menuItems = [];
let dbClient; // Para GridFS

async function cargarMenu() {
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    dbClient = client;
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const items = await db.collection(MENU_COLLECTION).find().toArray();
        menuItems = items;
        console.log('Menú cargado desde MongoDB:', menuItems);
    } catch (err) {
        console.error('Error cargando menú:', err);
    } finally {
        await client.close();
    }
}

// Cargar menú al iniciar el servidor
cargarMenu();

// Ruta para obtener el menú desde la base de datos
app.get('/menu', (req, res) => {
    res.json(menuItems);
});

// Endpoint para obtener imagen de GridFS
app.get('/menu/imagen/:id', async (req, res) => {
    const fileId = req.params.id;
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const bucket = new GridFSBucket(db, { bucketName: 'imagenesMenu' });
        const _id = new ObjectId(fileId);
        const downloadStream = bucket.openDownloadStream(_id);
        downloadStream.on('error', () => res.status(404).end());
        downloadStream.pipe(res);
    } catch (err) {
        res.status(500).end();
    } finally {
        await client.close();
    }
});

app.post('/menu', upload.single('imagen'), async (req, res) => {
    const { nombre, precio, descripcion } = req.body;
    if (!nombre || typeof precio === 'undefined' || !descripcion || !req.file) {
        return res.status(400).json({ error: 'Nombre, precio, descripción e imagen requeridos' });
    }
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        // Guardar imagen en GridFS
        const bucket = new GridFSBucket(db, { bucketName: 'imagenesMenu' });
        const uploadStream = bucket.openUploadStream(req.file.originalname, {
            contentType: req.file.mimetype
        });
        uploadStream.end(req.file.buffer);
        uploadStream.on('finish', async (file) => {
            // Guarda el producto con referencia a la imagen y descripción
            const result = await db.collection(MENU_COLLECTION).insertOne({
                nombre,
                precio: parseFloat(precio),
                descripcion,
                imagenId: file._id
            });
            await cargarMenu();
            io.emit('menuActualizado');
            res.json({ mensaje: 'Producto agregado', id: result.insertedId });
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al agregar producto' });
    } finally {
        // No cierres el cliente aquí porque el stream puede seguir abierto
    }
});

app.delete('/menu/:id', async (req, res) => {
    const id = req.params.id;
    // Validar que el id sea un ObjectId válido
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
        return res.status(400).json({ error: 'ID de producto inválido' });
    }
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        // Elimina el producto
        const prod = await db.collection(MENU_COLLECTION).findOneAndDelete({ _id: new ObjectId(id) });
        // Elimina la imagen de GridFS si existe
        if (prod.value && prod.value.imagenId) {
            const bucket = new GridFSBucket(db, { bucketName: 'imagenesMenu' });
            try { await bucket.delete(new ObjectId(prod.value.imagenId)); } catch {}
        }
        await cargarMenu();
        io.emit('menuActualizado');
        if (!prod.value) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'No se pudo eliminar el producto' });
    } finally {
        await client.close();
    }
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});

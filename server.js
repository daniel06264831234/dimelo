const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const cors = require('cors');

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

const pedidos = []; // Almacena los pedidos en memoria

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
    console.log('Pedido recibido:', pedido);
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

async function cargarMenu() {
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
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

app.post('/menu', async (req, res) => {
    const { nombre, precio } = req.body;
    if (!nombre || typeof precio !== 'number') {
        return res.status(400).json({ error: 'Nombre y precio requeridos' });
    }
    const client = new MongoClient(MONGO_URI, { useUnifiedTopology: true });
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const result = await db.collection(MENU_COLLECTION).insertOne({ nombre, precio });
        await cargarMenu(); // Actualiza el menú en memoria
        io.emit('menuActualizado'); // Notifica a todos los clientes
        res.json({ mensaje: 'Producto agregado', id: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: 'Error al agregar producto' });
    } finally {
        await client.close();
    }
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});


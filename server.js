const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// Estructura para salas: { [roomName]: { type, password, users: Set } }
const rooms = {};

io.on('connection', (socket) => {
    socket.on('create room', ({ room, type, password }, cb) => {
        if (rooms[room]) {
            cb && cb({ ok: false, error: 'La sala ya existe' });
            return;
        }
        rooms[room] = { type, password: password || null, users: new Set() };
        cb && cb({ ok: true });
    });

    socket.on('get users in room', () => {
        if (socket.room && rooms[socket.room]) {
            io.to(socket.id).emit('users in room', Array.from(rooms[socket.room].users));
        }
    });

    socket.on('leave room', () => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].users.delete(socket.username);
            socket.leave(socket.room);
            io.to(socket.room).emit('message', { user: 'Sistema', text: `${socket.username} ha salido de la sala.` });
            io.to(socket.room).emit('update users');
            if (rooms[socket.room].users.size === 0) {
                delete rooms[socket.room];
            }
            socket.room = null;
        }
    });

    socket.on('join room', ({ room, username, password }, cb) => {
        const r = rooms[room];
        if (!r) {
            cb && cb({ ok: false, error: 'La sala no existe' });
            return;
        }
        if (r.password && r.password !== password) {
            cb && cb({ ok: false, error: 'Contraseña incorrecta' });
            return;
        }
        // Si ya estaba en otra sala, salir de esa sala
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].users.delete(socket.username);
            socket.leave(socket.room);
            io.to(socket.room).emit('message', { user: 'Sistema', text: `${socket.username} ha salido de la sala.` });
            io.to(socket.room).emit('update users');
            if (rooms[socket.room].users.size === 0) {
                delete rooms[socket.room];
            }
        }
        socket.username = username;
        socket.room = room;
        r.users.add(username);
        socket.join(room);
        socket.to(room).emit('message', { user: 'Sistema', text: `${username} se ha unido a la sala.` });
        io.to(room).emit('update users');
        cb && cb({ ok: true, type: r.type });
    });

    socket.on('chat message', (msg) => {
        if (socket.room) {
            io.to(socket.room).emit('message', { user: socket.username, text: msg });
        }
    });

    socket.on('chat image', (imgData) => {
        if (socket.room) {
            io.to(socket.room).emit('message', { user: socket.username, type: 'image', data: imgData });
        }
    });

    socket.on('get rooms', (cb) => {
        // Devuelve lista de salas sin contraseñas
        cb && cb(Object.entries(rooms).map(([name, r]) => ({
            name,
            type: r.type,
            private: !!r.password
        })));
    });

    socket.on('disconnect', () => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].users.delete(socket.username);
            io.to(socket.room).emit('message', { user: 'Sistema', text: `${socket.username} ha salido de la sala.` });
            io.to(socket.room).emit('update users');
            if (rooms[socket.room].users.size === 0) {
                delete rooms[socket.room];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`Servidor escuchando en http://${HOST}:${PORT}`);
});

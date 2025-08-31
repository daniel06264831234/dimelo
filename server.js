const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static(path.join(__dirname, 'public')));

// Estructura para salas: { [roomName]: { type, password, users: Set, timeout: Timeout } }
const rooms = {};
const INACTIVITY_MS = 5 * 60 * 1000; // 5 minutos

function resetRoomTimeout(room) {
    if (!rooms[room]) return;
    if (rooms[room].timeout) clearTimeout(rooms[room].timeout);
    rooms[room].timeout = setTimeout(() => {
        // Notifica y elimina la sala por inactividad
        io.to(room).emit('message', { user: 'Sistema', text: 'La sala se cerró por inactividad.' });
        io.to(room).emit('room closed');
        // Expulsa a todos los sockets de la sala
        const clients = io.sockets.adapter.rooms.get(room);
        if (clients) {
            for (const socketId of clients) {
                const s = io.sockets.sockets.get(socketId);
                if (s) {
                    s.leave(room);
                    if (s.room === room) s.room = null;
                }
            }
        }
        delete rooms[room];
    }, INACTIVITY_MS);
}

io.on('connection', (socket) => {
    socket.on('create room', ({ room, type, password }, cb) => {
        if (rooms[room]) {
            cb && cb({ ok: false, error: 'La sala ya existe' });
            return;
        }
        rooms[room] = { type, password: password || null, users: new Set() };
        resetRoomTimeout(room);
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
                clearTimeout(rooms[socket.room].timeout);
                delete rooms[socket.room];
            } else {
                resetRoomTimeout(socket.room);
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
        // Verifica que el nombre de usuario no esté repetido en la sala
        if (r.users.has(username)) {
            cb && cb({ ok: false, error: 'Ese nombre ya está en uso en la sala. Elige otro.' });
            return;
        }
        // Si ya estaba en otra sala, salir de esa sala
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].users.delete(socket.username);
            socket.leave(socket.room);
            io.to(socket.room).emit('message', { user: 'Sistema', text: `${socket.username} ha salido de la sala.` });
            io.to(socket.room).emit('update users');
            if (rooms[socket.room].users.size === 0) {
                clearTimeout(rooms[socket.room].timeout);
                delete rooms[socket.room];
            } else {
                resetRoomTimeout(socket.room);
            }
        }
        socket.username = username;
        socket.room = room;
        r.users.add(username);
        socket.join(room);
        socket.to(room).emit('message', { user: 'Sistema', text: `${username} se ha unido a la sala.` });
        io.to(room).emit('update users');
        resetRoomTimeout(room);
        cb && cb({ ok: true, type: r.type });
    });

    socket.on('chat message', (msg) => {
        if (socket.room && rooms[socket.room]) {
            io.to(socket.room).emit('message', { user: socket.username, text: msg });
            resetRoomTimeout(socket.room);
        }
    });

    socket.on('chat image', (imgData) => {
        if (socket.room && rooms[socket.room]) {
            io.to(socket.room).emit('message', { user: socket.username, type: 'image', data: imgData });
            resetRoomTimeout(socket.room);
        }
    });

    socket.on('get rooms', (cb) => {
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
                clearTimeout(rooms[socket.room].timeout);
                delete rooms[socket.room];
            } else {
                resetRoomTimeout(socket.room);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
    console.log(`Servidor escuchando en http://${HOST}:${PORT}`);
});


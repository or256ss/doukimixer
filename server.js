import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json()); // Required to parse JSON POST bodies

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// Configure multer for audio file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // allow vite dev server
        methods: ["GET", "POST"]
    }
});

// --- Multi-Room State ---
// RoomID (8 char) -> { roomName, audioState, commentState, mixerStates, savedSettings, activeUsers, userCount }
const rooms = {};

function getOrCreateRoom(roomId, roomName = "Unnamed Room") {
    if (!rooms[roomId]) {
        rooms[roomId] = {
            roomName: roomName,
            audioState: {},
            commentState: "",
            mixerStates: {},
            savedSettings: {},
            activeUsers: new Map(),
            userCount: 0
        };
    }
    return rooms[roomId];
}

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Allow a socket to join a specific room BEFORE logging in
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        socket.roomId = roomId;
    });

    // Handle login within a room
    socket.on('login', () => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = getOrCreateRoom(roomId);

        let i = 1;
        const currentUsers = Array.from(room.activeUsers.values()).map(u => u.id);
        while (currentUsers.includes(`User${i}`)) {
            i++;
        }
        const userId = `User${i}`;

        room.activeUsers.set(socket.id, { id: userId });
        console.log(`${userId} logged into room ${roomId}`);

        socket.emit('login_success', { userId });
        io.to(roomId).emit('user_update', Array.from(room.activeUsers.values()));

        const initialAudioArray = Object.values(room.audioState);
        socket.emit('initial_state', initialAudioArray);

        if (room.commentState !== undefined && room.commentState !== "") {
            socket.emit('sync_comment', room.commentState);
        }

        socket.emit('settings_list_update', Object.keys(room.savedSettings));
    });

    // --- NTP Clock Sync ---
    socket.on('ping', (clientTime) => {
        socket.emit('pong', { clientTime, serverTime: Date.now() });
    });

    // --- State Sync Handlers ---
    socket.on('track_loaded', (data) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        console.log(`Room ${roomId}: Track ${data.trackIndex} loaded by ${data.loadedBy}`);
        room.audioState[data.trackIndex] = data;
        socket.to(roomId).emit('sync_track_loaded', data);
    });

    socket.on('track_deleted', (trackIndex) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.audioState[trackIndex]) {
            console.log(`Room ${roomId}: Track ${trackIndex} deleted`);
            delete room.audioState[trackIndex];
            socket.to(roomId).emit('sync_track_deleted', trackIndex);
        }
    });

    socket.on('transport_play', () => {
        // Increase target time padding to 1.0 second to ensure worst-case network pings 
        // receive the message before the target expiration, ensuring perfect WebAudio scheduling.
        const targetTime = Date.now() + 1000;
        if (socket.roomId) {
            io.to(socket.roomId).emit('sync_play', { targetTime });
        }
    });

    socket.on('transport_stop', () => {
        if (socket.roomId) {
            io.to(socket.roomId).emit('sync_stop');
        }
    });

    socket.on('transport_seek', (data) => {
        if (socket.roomId) {
            socket.to(socket.roomId).emit('sync_seek', data.time);
        }
    });

    socket.on('update_comment', (text) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        room.commentState = text;
        socket.to(socket.roomId).emit('sync_comment', text);
    });

    socket.on('mixer_state_update', (data) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        room.mixerStates[data.userId] = data.tracksState;
    });

    socket.on('save_setting', (settingName) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        room.savedSettings[settingName] = {
            audio: JSON.parse(JSON.stringify(room.audioState)),
            comment: room.commentState,
            mixers: JSON.parse(JSON.stringify(room.mixerStates))
        };
        console.log(`Room ${socket.roomId}: Saved setting: ${settingName}`);
        io.to(socket.roomId).emit('settings_list_update', Object.keys(room.savedSettings));
    });

    socket.on('delete_setting', (settingName) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        if (room.savedSettings[settingName]) {
            delete room.savedSettings[settingName];
            console.log(`Room ${socket.roomId}: Deleted setting: ${settingName}`);
            io.to(socket.roomId).emit('settings_list_update', Object.keys(room.savedSettings));
        }
    });

    socket.on('load_setting', (settingName) => {
        const room = rooms[socket.roomId];
        if (!room) return;
        const scene = room.savedSettings[settingName];
        if (scene) {
            console.log(`Room ${socket.roomId}: Loading setting: ${settingName}`);
            room.audioState = JSON.parse(JSON.stringify(scene.audio));
            room.commentState = scene.comment;
            room.mixerStates = JSON.parse(JSON.stringify(scene.mixers));

            io.to(socket.roomId).emit('sync_setting_applied', {
                name: settingName,
                audio: Object.values(room.audioState),
                comment: room.commentState,
                mixers: room.mixerStates
            });
        }
    });

    socket.on('reset_all', () => {
        const room = rooms[socket.roomId];
        if (!room) return;
        console.log(`Room ${socket.roomId}: Reset all triggered`);
        room.audioState = {};
        room.commentState = "";
        room.mixerStates = {};
        io.to(socket.roomId).emit('force_logout');
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.activeUsers.has(socket.id)) {
            const user = room.activeUsers.get(socket.id);
            console.log(`Room ${roomId}: ${user.id} disconnected.`);
            room.activeUsers.delete(socket.id);
            io.to(roomId).emit('user_update', Array.from(room.activeUsers.values()));
        }
    });
});

// --- REST Endpoints ---

app.get('/api/rooms', (req, res) => {
    const roomList = Object.keys(rooms).map(id => ({
        id,
        name: rooms[id].roomName,
        userCount: rooms[id].activeUsers.size
    }));
    res.json(roomList);
});

app.post('/api/rooms', (req, res) => {
    const { roomName } = req.body;
    const roomId = crypto.randomBytes(4).toString('hex'); // 8 char hex string
    getOrCreateRoom(roomId, roomName || 'Douki Room');
    res.json({ id: roomId });
});

app.delete('/api/rooms/:id', (req, res) => {
    const roomId = req.params.id;
    if (rooms[roomId]) {
        io.to(roomId).emit('force_logout');
        delete rooms[roomId];
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Room not found' });
    }
});

// Upload Endpoint
app.post('/upload', upload.single('audioFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ fileUrl, fileName: req.file.originalname });
});

// Serve frontend static files from 'dist'
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for React Router
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`MTR Sync Server running on port ${PORT} across all network interfaces`);
});

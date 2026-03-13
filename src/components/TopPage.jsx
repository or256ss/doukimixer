import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './TopPage.css';

export default function TopPage() {
    const [rooms, setRooms] = useState([]);
    const navigate = useNavigate();

    const fetchRooms = async () => {
        try {
            const serverUrl = '';
            const response = await fetch(`${serverUrl}/api/rooms`);
            if (response.ok) {
                const data = await response.json();
                setRooms(data);
            }
        } catch (err) {
            console.error("Failed to fetch rooms", err);
        }
    };

    useEffect(() => {
        fetchRooms();
        const interval = setInterval(fetchRooms, 5000); // refresh every 5s
        return () => clearInterval(interval);
    }, []);

    const handleCreateRoom = async () => {
        const roomName = window.prompt("作成するルーム名を入力してください（未入力の場合は自動設定されます）:");
        if (roomName === null) return; // Cancelled

        try {
            const serverUrl = '';
            const response = await fetch(`${serverUrl}/api/rooms`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ roomName: roomName.trim() })
            });

            if (response.ok) {
                const data = await response.json();
                navigate(`/${data.id}`);
            }
        } catch (err) {
            console.error("Failed to create room", err);
        }
    };

    const handleDeleteRoom = async (e, roomId) => {
        e.stopPropagation();
        const confirmDelete = window.confirm(`ルーム「${roomId}」を削除しますか？\n（参加中の全てのユーザーが強制退出されます）`);
        if (!confirmDelete) return;

        try {
            const serverUrl = '';
            const response = await fetch(`${serverUrl}/api/rooms/${roomId}`, { method: 'DELETE' });
            if (response.ok) {
                fetchRooms();
            }
        } catch (err) {
            console.error("Failed to delete room", err);
        }
    };

    return (
        <div className="top-page">
            <header className="top-header">
                <h1>Douki Mixer</h1>
                <p className="subtitle">Real-Time Multiplayer Audio Workstation</p>
            </header>

            <main className="lobby-container">
                <div className="lobby-controls">
                    <button className="create-room-btn" onClick={handleCreateRoom}>
                        + 新しいルームを作成
                    </button>
                    <button className="refresh-btn" onClick={fetchRooms} title="更新">
                        🔄
                    </button>
                </div>

                <h2>アクティブルーム一覧</h2>
                {rooms.length === 0 ? (
                    <div className="empty-rooms">現在アクティブなルームはありません。</div>
                ) : (
                    <ul className="room-list">
                        {rooms.map(room => (
                            <li key={room.id} className="room-card" onClick={() => navigate(`/${room.id}`)}>
                                <div className="room-info">
                                    <span className="room-id" style={{ cursor: 'pointer', color: '#fff', textDecoration: 'underline' }}>
                                        {room.name || 'Douki Room'}
                                    </span>
                                    <span className="room-users">👥 {room.userCount}人 参加中</span>
                                </div>
                                <button
                                    className="delete-room-btn"
                                    onClick={(e) => handleDeleteRoom(e, room.id)}
                                    title="ルームを削除"
                                >
                                    🗑️
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </main>
        </div>
    );
}

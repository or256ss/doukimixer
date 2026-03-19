import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useParams, useNavigate } from 'react-router-dom';
import { audioEngine } from './audio/AudioEngine';
import TrackStrip from './components/TrackStrip';
import MasterStrip from './components/MasterStrip';
import Transport from './components/Transport';
import SettingsModal from './components/SettingsModal';
import './components/MTRLayout.css';

export default function MTRRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const numTracks = 6;

  // State for UI to reflect track properties
  const [tracksState, setTracksState] = useState(
    Array.from({ length: numTracks }, (_, i) => ({
      volume: 0.8,
      pan: 0,
      isMuted: false,
      isSoloed: false,
      hasAudio: false,
      fileName: null
    }))
  );

  const [masterVolume, setMasterVolume] = useState(0.8);
  const [isPlaying, setIsPlaying] = useState(false);
  const [globalComment, setGlobalComment] = useState("");

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState('save'); // 'save' or 'load'
  const [savedSettingsList, setSavedSettingsList] = useState([]);
  const [currentSettingName, setCurrentSettingName] = useState(null);

  // Multiplayer State
  const [socket, setSocket] = useState(null);
  const [currentUser, setCurrentUser] = useState(null); // e.g. 'User1'
  const [activeUsers, setActiveUsers] = useState([]); // [{id: 'User1'}, ...]
  const serverOffsetRef = useRef(0); // Offset to add to local Date.now() to get Server time
  const minRttRef = useRef(Infinity); // Track best RTT for NTP accuracy
  const pingIntervalRef = useRef(null);
  const isInitiatedRef = useRef(false);

  // Auto-login on mount
  useEffect(() => {
    if (!isInitiatedRef.current) {
      isInitiatedRef.current = true;
      handleLogin(); // Auto-login when the room page is accessed
    }
  }, []);

  useEffect(() => {
    return () => {
      // Free all loaded memory buffers and WebAudio nodes.
      // If we don't do this, navigating out of the room retains the gigabytes of 
      // floating memory, carrying "ghost tracks" into new rooms and crashing Safari.
      audioEngine.clearAllTracks(); 
      if (socket) socket.disconnect();
    };
  }, [socket]);

  // Sync mixer state to server continuously so it can be saved at any moment
  useEffect(() => {
    if (socket && currentUser) {
      socket.emit('mixer_state_update', { userId: currentUser, tracksState });
    }
  }, [tracksState, socket, currentUser]);

  const handleLogin = () => {
    // Connect to the generic origin URL
    const serverUrl = '';
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect_error', (err) => {
      console.error("Connection error:", err);
      // Optional: show a proper error UI here
    });

    // --- NTP Clock Sync ---
    newSocket.on('pong', (data) => {
      // Calculate Network Round Trip Time
      const now = Date.now();
      const rtt = now - data.clientTime;
      const latency = rtt / 2;
      
      // Update our clock offset ONLY if this RTT is better than our previous best.
      // High-latency pings are asymmetrical and ruin sync on cloud servers.
      if (rtt <= minRttRef.current) {
        minRttRef.current = rtt;
        const estimatedServerTime = data.serverTime + latency;
        serverOffsetRef.current = estimatedServerTime - now;
      }
      
      // Removed minRttRef decay. The difference between the server and client hardware clock
      // is physically static. Decaying this value allowed future, high-jitter asymmetric network 
      // pings to falsely recalculate and corrupt the offset, ruining multi-playback sync.
    });

    newSocket.on('connect', () => {
      newSocket.emit('join_room', roomId);
      newSocket.emit('login');
    });

    newSocket.on('login_success', (data) => {
      setCurrentUser(data.userId);

      // Fire an instantaneous ping immediately so we don't wait 2 seconds for the first time calibration
      // If we wait 2 seconds, any play commands executed too early will use a raw offset of 0, 
      // causing the target time calculator to mistake minor hardware clock drift as a massive future delay.
      newSocket.emit('ping', Date.now());

      // Start pinging every 2 seconds to keep clock synced continuously
      pingIntervalRef.current = setInterval(() => {
        newSocket.emit('ping', Date.now());
      }, 2000);
    });

    newSocket.on('user_update', (users) => {
      setActiveUsers(users);
    });

    newSocket.on('initial_state', async (tracksData) => {
      // Create a fresh array copy
      const newTracksState = [...tracksState];
      const serverUrl = '';

      for (const data of tracksData) {
        const fullUrl = `${serverUrl}${data.fileUrl}`;
        const success = await audioEngine.loadAudioFromUrl(data.trackIndex, fullUrl);
        if (success) {
          // Clone the specific object being modified
          newTracksState[data.trackIndex] = {
            ...newTracksState[data.trackIndex],
            hasAudio: true,
            fileName: data.fileName
          };
        }
      }
      setTracksState(newTracksState);
    });

    newSocket.on('sync_track_loaded', async (data) => {
      // data: { trackIndex, fileUrl, fileName, loadedBy }
      const serverUrl = '';
      const fullUrl = `${serverUrl}${data.fileUrl}`;
      const success = await audioEngine.loadAudioFromUrl(data.trackIndex, fullUrl);
      if (success) {
        setTracksState(prev => {
          const newState = [...prev];
          newState[data.trackIndex].hasAudio = true;
          newState[data.trackIndex].fileName = data.fileName;
          return newState;
        });
      }
    });

    newSocket.on('sync_track_deleted', (trackIndex) => {
      // Clear AudioEngine Buffer
      const track = audioEngine.tracks[trackIndex];
      if (track) {
        if (track.sourceNode) {
          track.sourceNode.stop();
          track.sourceNode.disconnect();
          track.sourceNode = null;
        }
        track.buffer = null;
      }

      // Update UI 
      setTracksState(prev => {
        const newState = [...prev];
        newState[trackIndex].hasAudio = false;
        newState[trackIndex].fileName = null;
        return newState;
      });
    });

    newSocket.on('sync_play', (data) => {
      // data: { targetTime }
      // 1. When is the targetTime in OUR local Date.now() time?
      const localTargetTime = data.targetTime - serverOffsetRef.current;

      // 2. How many milliseconds into the future is that? 
      // (If it's negative, we are already late, so start immediately)
      const delayMs = Math.max(0, localTargetTime - Date.now());

      // 3. What is that target time in the Web Audio context's internal high-precision clock?
      const scheduledContextTime = audioEngine.audioContext.currentTime + (delayMs / 1000);

      // 4. Issue the precision start command
      audioEngine.play(scheduledContextTime);
      setIsPlaying(true);
    });

    newSocket.on('sync_stop', () => {
      audioEngine.stop();
      setIsPlaying(false);
    });

    newSocket.on('sync_seek', (time) => {
      audioEngine.seek(time);
      // Let UI update naturally via Transport's periodic check
    });

    newSocket.on('sync_comment', (commentText) => {
      setGlobalComment(commentText);
    });

    // --- Settings Sync ---
    newSocket.on('settings_list_update', (list) => {
      setSavedSettingsList(list);
    });

    newSocket.on('sync_setting_applied', async (sceneData) => {
      setCurrentSettingName(sceneData.name);

      // 1. Stop current playback to prevent timing orphaned nodes
      audioEngine.stop();
      setIsPlaying(false);

      // 2. Erase ALL current tracks in memory fully explicitly before parsing the new scene
      audioEngine.tracks.forEach((track, i) => {
        if (track.buffer) {
          if (track.sourceNode) {
            track.sourceNode.stop();
            track.sourceNode.disconnect();
            track.sourceNode = null;
          }
          track.buffer = null;
        }
      });

      // 3. Restore Audio Buffers from the loaded Scene
      for (const data of sceneData.audio) {
        const fullUrl = data.fileUrl;
        await audioEngine.loadAudioFromUrl(data.trackIndex, fullUrl);
      }

      const sceneAudioIndices = new Set(sceneData.audio.map(a => a.trackIndex));

      // 3. Apply Comment
      setGlobalComment(sceneData.comment);

      // 4. Determine state for our UI from the global dictionary
      let myMixerState = sceneData.mixers[currentUser];

      // Fallback: If we don't have our own saved mix (e.g. we just joined or refreshed the page),
      // inherit the mix of the person who originally saved this scene.
      if (!myMixerState && Object.keys(sceneData.mixers).length > 0) {
        myMixerState = Object.values(sceneData.mixers)[0];
      }

      if (myMixerState) {
        // Merge the saved fader/pan/mute positions with the GUARANTEED TRUTH of the loaded audio files
        const updatedMixerState = myMixerState.map((t, idx) => ({
          ...t,
          hasAudio: sceneAudioIndices.has(idx),
          fileName: sceneData.audio.find(a => a.trackIndex === idx)?.fileName || null
        }));

        setTracksState(updatedMixerState);

        // push physical Engine updates
        updatedMixerState.forEach((t, i) => {
          audioEngine.setVolume(i, t.volume);
          audioEngine.setPan(i, t.pan);
        });
        updateEffectiveMutes(updatedMixerState);
      } else {
        // Absolute fallback (almost never hit unless scene was inexplicably completely empty)
        setTracksState(prev => prev.map((t, idx) => ({
          ...t,
          hasAudio: sceneAudioIndices.has(idx),
          fileName: sceneData.audio.find(a => a.trackIndex === idx)?.fileName || null
        })));
      }
    });

    newSocket.on('force_logout', () => {
      handleLogout();
    });
  };

  const handleLogout = () => {
    // Stop any currently playing audio
    audioEngine.stop();
    setIsPlaying(false);

    if (socket) {
      socket.disconnect();
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    setSocket(null);
    setCurrentUser(null);
    setActiveUsers([]);
    serverOffsetRef.current = 0;
  };

  // Handlers for TrackStrip
  const handleFileLoad = async (index, file) => {
    // 1. Load locally for immediate feedback
    const success = await audioEngine.loadAudio(index, file);
    if (!success) return;

    setTracksState(prev => {
      const newState = [...prev];
      newState[index].hasAudio = true;
      newState[index].fileName = file.name;
      return newState;
    });

    // 2. If logged in, upload the file and broadcast to others
    if (socket && currentUser) {
      const formData = new FormData();
      formData.append('audioFile', file);

      try {
        const serverUrl = '';
        const response = await fetch(`${serverUrl}/upload`, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          // Emit socket event with the RELATIVE path so other clients construct their own IPs
          socket.emit('track_loaded', {
            trackIndex: index,
            fileUrl: data.fileUrl,
            fileName: data.fileName,
            loadedBy: currentUser
          });
        }
      } catch (err) {
        console.error("Error uploading file for sync", err);
      }
    }
  };

  const handleFileDelete = (index) => {
    // 1. Clear locally
    const track = audioEngine.tracks[index];
    if (track) {
      if (track.sourceNode) {
        track.sourceNode.stop();
        track.sourceNode.disconnect();
        track.sourceNode = null;
      }
      track.buffer = null;
    }

    setTracksState(prev => {
      const newState = [...prev];
      newState[index].hasAudio = false;
      newState[index].fileName = null;
      return newState;
    });

    // 2. Notify others
    if (socket && currentUser) {
      socket.emit('track_deleted', index);
    }
  };

  const handleVolumeChange = (index, value) => {
    audioEngine.setVolume(index, value);
    setTracksState(prev => {
      const newState = [...prev];
      newState[index] = { ...newState[index], volume: value };
      return newState;
    });
  };

  const handlePanChange = (index, value) => {
    audioEngine.setPan(index, value);
    setTracksState(prev => {
      const newState = [...prev];
      newState[index] = { ...newState[index], pan: value };
      return newState;
    });
  };

  const updateEffectiveMutes = (tracksArray) => {
    // Determine if ANY track has the solo button active
    const isAnySoloed = tracksArray.some(t => t.isSoloed);

    tracksArray.forEach((track, idx) => {
      // If a track is explicitly muted by the user, it remains muted regardless of solo.
      // If ANY track is soloed globally, and THIS track is NOT soloed, effectively mute it.
      // Otherwise, the effective mute state is false (audio plays).
      const effectiveMute = track.isMuted || (isAnySoloed && !track.isSoloed);
      audioEngine.setMute(idx, effectiveMute);
    });
  };

  const handleMuteToggle = (index) => {
    setTracksState(prev => {
      const newState = [...prev];
      newState[index] = { ...newState[index], isMuted: !newState[index].isMuted };
      updateEffectiveMutes(newState);
      return newState;
    });
  };

  const handleSoloToggle = (index) => {
    setTracksState(prev => {
      const newState = [...prev];
      newState[index] = { ...newState[index], isSoloed: !newState[index].isSoloed };
      updateEffectiveMutes(newState);
      return newState;
    });
  };

  const handleMasterVolumeChange = (value) => {
    audioEngine.setMasterVolume(value);
    setMasterVolume(value);
  };

  const handleCommentChange = (e) => {
    const newText = e.target.value;
    setGlobalComment(newText);
    if (socket && currentUser) {
      socket.emit('update_comment', newText);
    }
  };

  // Handlers for Transport
  const handlePlay = () => {
    if (socket && currentUser) {
      socket.emit('transport_play');
    } else {
      audioEngine.play();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    if (socket && currentUser) {
      socket.emit('transport_stop');
    } else {
      audioEngine.stop();
      setIsPlaying(false);
    }
  };

  const handleSeek = (time) => {
    if (socket && currentUser) {
      socket.emit('transport_seek', { time });
    }
    audioEngine.seek(time);
  };

  // --- Settings Actions ---
  const handleOpenSettings = (mode) => {
    setSettingsMode(mode);
    setIsSettingsOpen(true);
  };

  const handleSaveSetting = (name) => {
    if (socket) {
      socket.emit('save_setting', name);
      setCurrentSettingName(name); // immediately assume responsibility
    }
  };

  const handleLoadSetting = (name) => {
    if (socket) socket.emit('load_setting', name);
  };

  const handleDeleteSetting = (name) => {
    if (socket) socket.emit('delete_setting', name);
  };

  const handleResetAll = () => {
    const confirmReset = window.confirm("全ての設定を初期化し、全ユーザーを強制ログアウトさせますか？");
    if (confirmReset && socket) {
      socket.emit('reset_all');
    }
  };

  return (
    <div className="mtr-app">
      <header className="mtr-header">
        <div className="header-top">
          <div className="title-section">
            <div className="title-row">
              <button className="back-btn" onClick={() => navigate('/')} title="ロビーに戻る">⬅</button>
              <h1>Douki Mixer</h1>
            </div>
            <p className="subtitle">Room ID: {roomId}</p>
          </div>

          <div className="user-section">
            {currentUser && (
              <div className="settings-controls">
                {currentSettingName && (
                  <div className="current-setting-badge">
                    [ {currentSettingName} ]
                  </div>
                )}
                <button className="settings-btn" onClick={() => handleOpenSettings('save')}>SAVE</button>
                <button className="settings-btn" onClick={() => handleOpenSettings('load')}>LOAD</button>
                <button className="settings-btn reset-btn" onClick={handleResetAll}>RESET</button>
              </div>
            )}
            {!currentUser ? (
              <button className="auth-btn login-btn" onClick={handleLogin}>
                LOGIN
              </button>
            ) : (
              <div className="logged-in-container">
                <div className="user-badge">
                  <span className="user-icon">👤</span>
                  <span className="user-name">{currentUser}</span>
                </div>
                <button className="auth-btn logout-btn" onClick={handleLogout}>
                  LOGOUT
                </button>
              </div>
            )}
          </div>
        </div>

        {activeUsers.length > 0 && (
          <div className="active-users-bar">
            <span className="active-users-label">Active Users: </span>
            {activeUsers.map(u => (
              <span key={u.id} className={`active-user-pill ${u.id === currentUser ? 'me' : ''}`}>
                {u.id}
              </span>
            ))}
          </div>
        )}
      </header>

      {currentUser && (
        <div className="comment-section">
          <textarea
            className="global-comment-box"
            placeholder="共有レコーディングメモを入力..."
            value={globalComment}
            onChange={handleCommentChange}
          />
        </div>
      )}

      <div className="mixer-panel">
        <div className="tracks-container">
          {tracksState.map((track, i) => (
            <TrackStrip
              key={i}
              index={i}
              volume={track.volume}
              pan={track.pan}
              isMuted={track.isMuted}
              isSoloed={track.isSoloed}
              hasAudio={track.hasAudio}
              fileName={track.fileName}
              onFileLoad={handleFileLoad}
              onFileDelete={handleFileDelete}
              onVolumeChange={handleVolumeChange}
              onPanChange={handlePanChange}
              onMuteToggle={handleMuteToggle}
              onSoloToggle={handleSoloToggle}
            />
          ))}
        </div>
        <div className="master-container">
          <MasterStrip volume={masterVolume} onVolumeChange={handleMasterVolumeChange} />
        </div>
      </div>

      <div className="transport-panel">
        <Transport
          isPlaying={isPlaying}
          onPlay={handlePlay}
          onStop={handleStop}
          onSeek={handleSeek}
          getMaxDuration={() => audioEngine.getMaxDuration()}
          getCurrentTime={() => audioEngine.getCurrentTime()}
        />
      </div>

      <SettingsModal
        isOpen={isSettingsOpen}
        mode={settingsMode}
        savedSettingsList={savedSettingsList}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSetting}
        onLoad={handleLoadSetting}
        onDelete={handleDeleteSetting}
      />
    </div>
  );
}

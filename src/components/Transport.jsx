import { useState, useEffect } from 'react';
import './Transport.css';

export default function Transport({
    isPlaying,
    onPlay,
    onStop,
    onSeek,
    getMaxDuration,
    getCurrentTime
}) {
    const [time, setTime] = useState(0);

    // Update time display when playing
    useEffect(() => {
        let animationFrameId;

        const updateTime = () => {
            setTime(getCurrentTime());
            if (isPlaying) {
                animationFrameId = requestAnimationFrame(updateTime);
            }
        };

        if (isPlaying) {
            animationFrameId = requestAnimationFrame(updateTime);
        } else {
            setTime(getCurrentTime()); // Update once to catch the final/paused time
        }

        return () => cancelAnimationFrame(animationFrameId);
    }, [isPlaying, getCurrentTime]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    };

    const maxDur = getMaxDuration();
    // Default to 100 if no audio is loaded, to prevent division by zero or errors
    const maxVal = maxDur > 0 ? maxDur : 100;

    const handleSeekChange = (e) => {
        const newTime = parseFloat(e.target.value);
        setTime(newTime);
        if (onSeek) onSeek(newTime);
    };

    return (
        <div className="transport-container">
            <div className="seek-bar-container">
                <input
                    type="range"
                    min="0"
                    max={maxVal}
                    step="0.01"
                    value={time}
                    onChange={handleSeekChange}
                    className="seek-bar"
                    disabled={maxDur === 0}
                />
            </div>

            <div className="time-display">
                <div className="time-screen">
                    <span className="time-led">{formatTime(time)}</span>
                </div>
            </div>

            <div className="controls">
                <button
                    className="transport-btn stop-btn"
                    onClick={onStop}
                >
                    <div className="btn-icon"></div>
                    STOP
                </button>

                <button
                    className={`transport-btn play-btn ${isPlaying ? 'active' : ''}`}
                    onClick={onPlay}
                >
                    <div className="btn-icon">PLAY</div>
                </button>
            </div>
        </div>
    );
}

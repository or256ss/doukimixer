import { useRef, useState, useEffect } from 'react';
import './TrackStrip.css'; // We will create this specific CSS for the strip

export default function TrackStrip({
    index,
    volume,
    pan,
    isMuted,
    isSoloed,
    hasAudio,
    fileName,
    onFileLoad,
    onFileDelete,
    onVolumeChange,
    onPanChange,
    onMuteToggle,
    onSoloToggle
}) {
    const fileInputRef = useRef(null);
    const [popup, setPopup] = useState({ visible: false, type: null, value: '' });
    const popupTimeoutRef = useRef(null);
    const pressTimerRef = useRef(null);

    // Clear timeout on unmount
    useEffect(() => {
        return () => {
            if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        };
    }, []);

    const showPopup = (type, val) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ visible: true, type, value: val });
        popupTimeoutRef.current = setTimeout(() => {
            setPopup(prev => ({ ...prev, visible: false }));
        }, 1000); // hide after 1 second of inactivity
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            onFileLoad(index, file);
        }
    };

    const handlePointerDown = (e) => {
        // Only trigger on primary click/touch
        if (e.button !== 0 && e.pointerType !== 'touch') return;

        pressTimerRef.current = setTimeout(() => {
            if (hasAudio) {
                const confirmDelete = window.confirm(`TRACK ${index + 1}の音声ファイルを削除しますか？`);
                if (confirmDelete) {
                    onFileDelete(index);
                }
            }
            pressTimerRef.current = null;
        }, 800); // 800ms long press
    };

    const handlePointerUpOrLeave = () => {
        if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
    };

    const handleFileClick = () => {
        // If they just clicked normally (timer didn't expire), and we don't have audio, open dialog.
        // If we DO have audio, normal click does nothing unless they want to overwrite (currently disabled to save them from accidental overwrites, they must delete first).
        if (!hasAudio && fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const displayFileName = () => {
        if (!fileName) return 'LOAD';
        const parts = fileName.split('.');
        if (parts.length > 1) {
            parts.pop(); // remove extension
        }
        return parts.join('.');
    };

    const handlePanInput = (e) => {
        let val = parseFloat(e.target.value);

        // Center Snap Logic: if within ±0.15, force it to 0
        if (val > -0.15 && val < 0.15) {
            val = 0;
        }

        onPanChange(index, val);

        let displayVal = 'C';
        if (val < 0) displayVal = `L${Math.abs(Math.round(val * 100))}`;
        else if (val > 0) displayVal = `R${Math.round(val * 100)}`;
        showPopup('pan', displayVal);
    };

    const handleVolumeInput = (e) => {
        const val = parseFloat(e.target.value);
        onVolumeChange(index, val);
        showPopup('volume', (val * 100).toFixed(0));
    };

    // Convert pan value (-1 to 1) to rotation degree for knob (-135deg to +135deg)
    const panDegree = pan * 135;

    return (
        <div className={`track-strip ${hasAudio ? 'has-audio' : ''}`}>
            <div className="track-header">
                <span className="track-number">TRACK {index + 1}</span>
            </div>

            <div className="track-file-section">
                <button
                    className="load-btn"
                    onClick={handleFileClick}
                    onPointerDown={handlePointerDown}
                    onPointerUp={handlePointerUpOrLeave}
                    onPointerLeave={handlePointerUpOrLeave}
                    title={fileName || "Load Audio File"}
                    style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%'
                    }}
                >
                    {hasAudio ? displayFileName() : 'LOAD'}
                </button>
                <input
                    type="file"
                    accept="audio/*"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                />
                {fileName && <div className="file-name-tooltip">{fileName}</div>}
            </div>

            <div className="track-pan-section">
                <label>PAN</label>
                <div className="knob-container">
                    {popup.visible && popup.type === 'pan' && (
                        <div className="value-popup">{popup.value}</div>
                    )}
                    <div className="knob" style={{ transform: `rotate(${panDegree}deg)` }}>
                        <div className="knob-indicator"></div>
                    </div>
                    <input
                        type="range"
                        min="-1"
                        max="1"
                        step="0.01"
                        value={pan}
                        onChange={handlePanInput}
                        onPointerDown={(e) => handlePanInput(e)}
                        className="knob-input"
                    />
                </div>
            </div>

            <div className="track-mute-section">
                <button
                    className={`mute-btn ${isMuted ? 'active' : ''}`}
                    onClick={() => onMuteToggle(index)}
                >
                    <span className="led"></span>
                    MUTE
                </button>
                <button
                    className={`solo-btn ${isSoloed ? 'active' : ''}`}
                    onClick={() => onSoloToggle(index)}
                >
                    <span className="led"></span>
                    SOLO
                </button>
            </div>

            <div className="track-fader-section">
                <div className="fader-track">
                    {popup.visible && popup.type === 'volume' && (
                        <div className="value-popup">{popup.value}</div>
                    )}
                    <input
                        type="range"
                        min="0"
                        max="1.2"
                        step="0.01"
                        value={volume}
                        onChange={handleVolumeInput}
                        onPointerDown={(e) => handleVolumeInput(e)}
                        className="vertical-fader"
                    />
                </div>
                <label>LEVEL</label>
            </div>
        </div>
    );
}

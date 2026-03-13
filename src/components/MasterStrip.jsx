import { useState, useRef, useEffect } from 'react';
import './MasterStrip.css';

export default function MasterStrip({ volume, onVolumeChange }) {
    const [popup, setPopup] = useState({ visible: false, value: '' });
    const popupTimeoutRef = useRef(null);

    useEffect(() => {
        return () => {
            if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        };
    }, []);

    const showPopup = (val) => {
        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopup({ visible: true, value: val });
        popupTimeoutRef.current = setTimeout(() => {
            setPopup({ visible: false, value: '' });
        }, 1000);
    };

    const handleVolumeInput = (e) => {
        const val = parseFloat(e.target.value);
        onVolumeChange(val);
        showPopup((val * 100).toFixed(0));
    };

    return (
        <div className="master-strip">
            <div className="master-header">
                <span className="master-title">MASTER</span>
            </div>

            <div className="master-fader-section">
                <div className="fader-track master-fader-track">
                    {popup.visible && (
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
                        className="vertical-fader master-fader"
                    />
                </div>
                <label>LEVEL</label>
            </div>
        </div>
    );
}

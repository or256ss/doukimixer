import React, { useState } from 'react';
import './SettingsModal.css';

export default function SettingsModal({
    isOpen,
    onClose,
    mode, // 'save' or 'load'
    savedSettingsList,
    onSave,
    onLoad,
    onDelete
}) {
    const [inputValue, setInputValue] = useState('');
    if (!isOpen) return null;

    const handleSaveSubmit = (e) => {
        e.preventDefault();
        const trimVal = inputValue.trim();
        if (!trimVal) return;

        if (savedSettingsList.includes(trimVal)) {
            const confirmOverwrite = window.confirm(`"${trimVal}" は既に存在します。上書き保存しますか？`);
            if (!confirmOverwrite) return;
        }

        onSave(trimVal);
        setInputValue('');
        onClose();
    };

    const handleLoadClick = (name) => {
        onLoad(name);
        onClose();
    };

    const handleDeleteClick = (e, name) => {
        e.stopPropagation(); // prevent triggering row click
        const confirmDel = window.confirm(`設定 "${name}" を削除しますか？`);
        if (confirmDel) {
            onDelete(name);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h2>{mode === 'save' ? '設定を保存' : '設定を読み込む'}</h2>

                {mode === 'save' && (
                    <form className="save-form" onSubmit={handleSaveSubmit}>
                        <input
                            type="text"
                            placeholder="保存する設定名を入力..."
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            autoFocus
                        />
                        <button type="submit" className="action-btn">保存</button>
                    </form>
                )}

                <div className="settings-list">
                    {savedSettingsList.length === 0 ? (
                        <p className="no-settings">保存された設定はありません。</p>
                    ) : (
                        <ul>
                            {savedSettingsList.map(name => (
                                <li key={name} className="setting-list-item">
                                    {mode === 'load' ? (
                                        <>
                                            <button
                                                className="setting-item-btn"
                                                onClick={() => handleLoadClick(name)}
                                            >
                                                {name}
                                            </button>
                                            <button
                                                className="delete-setting-btn"
                                                onClick={(e) => handleDeleteClick(e, name)}
                                                title="削除"
                                            >
                                                🗑️
                                            </button>
                                        </>
                                    ) : (
                                        <div
                                            className="setting-item-btn save-overwrite-btn"
                                            onClick={() => {
                                                setInputValue(name);
                                            }}
                                            title="クリックして名前を入力欄にコピー"
                                        >
                                            {name}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="modal-actions">
                    <button className="cancel-btn" onClick={onClose}>閉じる</button>
                </div>
            </div>
        </div>
    );
}

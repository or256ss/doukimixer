import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import TopPage from './components/TopPage';
import MTRRoom from './MTRRoom';
import './index.css';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<TopPage />} />
                <Route path="/:roomId" element={<MTRRoom />} />
            </Routes>
        </BrowserRouter>
    );
}

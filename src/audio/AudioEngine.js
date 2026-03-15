import unmute from 'unmute';

class AudioEngine {
    constructor() {
        // Initialize Web Audio API context
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();

        // Enable iOS/Android silent switch bypass for WebAudio Contexts
        unmute(this.audioContext, true);

        this.tracks = [];
        this.numTracks = 8;

        // Master Gain Node
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.connect(this.audioContext.destination);
        this.masterGainNode.gain.value = 0.8;

        // Transport state
        this.isPlaying = false;
        this.startTime = 0;
        this.pausedAt = 0;

        // Initialize the 8 tracks with their persistent processing nodes
        for (let i = 0; i < this.numTracks; i++) {
            // Panner and Gain nodes are persistent and reused
            const pannerNode = this.audioContext.createStereoPanner();
            const gainNode = this.audioContext.createGain();

            pannerNode.connect(gainNode);
            gainNode.connect(this.masterGainNode);

            this.tracks.push({
                buffer: null,
                sourceNode: null,
                pannerNode: pannerNode,
                gainNode: gainNode,
                volume: 0.8, // Default volume (0.0 to 1.0)
                pan: 0.0,    // Default center pan (-1.0 to 1.0)
                isMuted: false
            });

            // Set initial node values
            gainNode.gain.value = 0.8;
            pannerNode.pan.value = 0.0;
        }
    }

    /**
     * Load an audio file into a specific track.
     * @param {number} trackIndex - Index of the track (0-7).
     * @param {File} file - The audio file from an <input type="file">.
     */
    async loadAudio(trackIndex, file) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) return false;

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            this.tracks[trackIndex].buffer = audioBuffer;

            // If we are currently playing, we should probably start this new buffer immediately,
            // but for a simple MTR, usually you load while stopped.
            // For safety, let's just assign it. It will play on the next play() call.
            return true;
        } catch (err) {
            console.error("Error loading audio file:", err);
            return false;
        }
    }

    /**
     * Load audio from a remote URL.
     */
    async loadAudioFromUrl(trackIndex, url) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) return false;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            this.tracks[trackIndex].buffer = audioBuffer;
            return true;
        } catch (err) {
            console.error("Error loading audio from URL:", err);
            return false;
        }
    }

    /**
     * Remove audio from a specific track.
     */
    clearTrack(trackIndex) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) return;
        const track = this.tracks[trackIndex];

        if (track.sourceNode) {
            try { track.sourceNode.stop(); } catch (e) { }
            track.sourceNode.disconnect();
            track.sourceNode = null;
        }
        track.buffer = null;
    }

    // --- Parameter Setters ---

    setVolume(trackIndex, value) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) return;
        const track = this.tracks[trackIndex];

        // Clamp value between 0 and 1 (or allow slight boost if desired)
        const clampedValue = Math.max(0, Math.min(1.2, value));
        track.volume = clampedValue;

        if (!track.isMuted) {
            // Use linearRampToValueAtTime to prevent audio clicks when dragging fader
            track.gainNode.gain.setTargetAtTime(clampedValue, this.audioContext.currentTime, 0.05);
        }
    }

    setMasterVolume(value) {
        const clampedValue = Math.max(0, Math.min(1.2, value));
        this.masterGainNode.gain.setTargetAtTime(clampedValue, this.audioContext.currentTime, 0.05);
    }

    setPan(trackIndex, value) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) return;
        const track = this.tracks[trackIndex];

        // Clamp between -1 (Left) and 1 (Right)
        const clampedValue = Math.max(-1, Math.min(1, value));
        track.pan = clampedValue;

        track.pannerNode.pan.setTargetAtTime(clampedValue, this.audioContext.currentTime, 0.05);
    }

    setMute(trackIndex, isMuted) {
        if (trackIndex < 0 || trackIndex >= this.numTracks) return;
        const track = this.tracks[trackIndex];
        track.isMuted = isMuted;

        const effectiveVolume = isMuted ? 0 : track.volume;
        track.gainNode.gain.setTargetAtTime(effectiveVolume, this.audioContext.currentTime, 0.05);
    }

    // --- Transport Controls ---

    play(scheduledContextTime = null) {
        if (this.isPlaying) return;

        // Browser autoplay policy requires user interaction to resume audio context
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const playAt = scheduledContextTime !== null ? scheduledContextTime : this.audioContext.currentTime;

        this.tracks.forEach(track => {
            if (track.buffer) {
                // AudioBufferSourceNode is one-time use, must recreate on play
                const source = this.audioContext.createBufferSource();
                source.buffer = track.buffer;
                source.connect(track.pannerNode);

                // Map Web Audio's stop event to clear our reference if it ends naturally
                source.onended = () => {
                    if (track.sourceNode === source) {
                        track.sourceNode = null;
                    }
                };

                source.start(playAt, this.pausedAt);
                track.sourceNode = source;
            }
        });

        // The start time is mathematically when the playhead *would have* been at 0.
        this.startTime = playAt - this.pausedAt;
        this.isPlaying = true;
    }

    pause() {
        if (!this.isPlaying) return;

        this.tracks.forEach(track => {
            if (track.sourceNode) {
                track.sourceNode.stop();
                track.sourceNode.disconnect();
                track.sourceNode = null;
            }
        });

        this.pausedAt = this.audioContext.currentTime - this.startTime;
        this.isPlaying = false;
    }

    stop() {
        this.pause();
        this.pausedAt = 0;
    }

    /**
     * Seek to a specific time.
     */
    seek(time) {
        if (time < 0) time = 0;
        const maxDur = this.getMaxDuration();
        if (maxDur > 0 && time > maxDur) time = maxDur;

        const wasPlaying = this.isPlaying;

        if (wasPlaying) {
            this.pause();
        }

        this.pausedAt = time;

        if (wasPlaying) {
            this.play();
        }
    }

    /**
     * Get current playback time in seconds.
     */
    getCurrentTime() {
        if (this.isPlaying) {
            // Guard against negative visual time before Scheduled time actually starts
            const calculatedTime = this.audioContext.currentTime - this.startTime;
            return Math.max(this.pausedAt, calculatedTime);
        }
        return this.pausedAt;
    }

    /**
     * Get the maximum duration among all loaded tracks.
     */
    getMaxDuration() {
        let max = 0;
        this.tracks.forEach(track => {
            if (track.buffer && track.buffer.duration > max) {
                max = track.buffer.duration;
            }
        });
        return max;
    }
}

// Export a singleton instance
export const audioEngine = new AudioEngine();

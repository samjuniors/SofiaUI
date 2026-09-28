# 🌌 Sophia OS: System Architecture

Sophia is not a traditional web application; it is a **real-time operating environment** designed as a digital entity. It treats the interface as a biological organism where state, audio, and visuals are deeply coupled.

## 🧬 The "Sense & Intellect" Model

Sophia is built on a modular organ-based architecture. This allows her to swap "providers" (APIs) without breaking the visual or behavioral logic.

### 👂 The Ear (Hearing / STT)
Responsible for capturing audio and converting it to intent.
*   **Primary**: `GeminiLiveProvider` (Full duplex, low latency).
*   **Fallback**: `DeepgramVoiceProvider` (Nova-3 streaming STT with server-side VAD).
*   **Local**: Browser `WebSpeech API`.

### 👄 The Mouth (Speaking / TTS)
Responsible for turning the Brain's output into expressive audio.
*   **Primary**: `Gemini Live` (Native expressive audio).
*   **Fallback**: `Deepgram Aura` (High-speed neural TTS, Aura-2 voice models).
*   **Custom Persona**: `ElevenLabs` (`/api/sophia/elevenlabs/speak` with dynamic voice IDs, stream playback, and barge-in).

### 🧠 The Brain (Thinking / LLM)
The central controller (`controlLayer`) that manages memory, tools, and personality.
*   **Primary Cloud**: `Gemini 3.8 Flash` (Long context, tool-calling).
*   **Alternative Cloud**: `Grok (xAI)`, `Claude Sonnet 4.6`, `OpenAI GPT-6 Sol` (all model IDs overridable via `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `XAI_MODEL`, `GEMINI_TEXT_MODEL`).
*   **Local Autonomous**: `Ollama` (`http://localhost:11434`, supporting local models like `ornith-1.5:9b`, `gemma4:cloud`, `llama3.2`) and `LM Studio` (`http://localhost:1234/v1`).

### 👁️ The Eye (Seeing / Vision)
Enables the entity to understand the user's world.
*   **Primary**: `Gemini Multimodal` (Real-time video/image stream).
*   **Fallback**: `OpenAI` (via `OPENAI_MODEL`).

---

## 🛠️ Technical Implementation Details

### 1. Visual Engine (The Body)
The visuals are driven by a **Reactive State Pipeline**:
`Audio Levels` $\rightarrow$ `VisualDirector` $\rightarrow$ `ParticleRenderer (WebGL2)`.
*   **SDF Geometry**: Sophia's form is based on Signed Distance Fields, allowing seamless morphing between spheres, rings, sacred shapes, and the `spiky` emotional state.
*   **Emotional Morphs**: High-frequency noise is injected into the radius of the shape when the Brain detects tension or negative sentiment.

### 2. Audio Pipeline
*   **Spatial Audio**: Uses `PannerNode` with HRTF (Head-Related Transfer Function) to position the voice at the 3D coordinates of the Orb.
*   **Barge-In**: Voice Activity Detection (VAD) and speech recognition interruption allow the user to interrupt Sophia, which immediately flushes the playback queue and returns her to the `listening` state.
*   **Mouth Multiplexer**: The TTS engine routes seamlessly between ElevenLabs (HD persona) and Deepgram Aura based on in-app user preference.

### 3. Activation Path
*   **Wake Word**: `WakeWordSpotter` monitors for "Hey Sophia".
*   **Gestural**: `AudioEngine` monitors for high-crest-factor transients (claps).
*   **Manual**: Keyboard shortcuts, HUD Mic button, or text chat.

---

## 📋 Agent's Guide (How to maintain Sophia)

If you are another agent working on this project, follow these rules:
1.  **Visuals**: Never edit `ParticleRenderer` without updating `VisualDirector`. The director defines the *what*, the renderer defines the *how*.
2.  **Voice**: All new voice providers MUST extend `VoiceProvider` and emit normalized events (`thinking`, `listening`, etc.).
3.  **Logic**: The `controlLayer` is the only place where "thinking" happens. Do not put LLM logic inside the UI components.
4.  **Boot**: Ensure `BootScreen` remains the entry point for microphone permission handling.

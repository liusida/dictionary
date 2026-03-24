import { useState, useRef, useEffect } from "react";
import CountryFlag from "react-country-flag";

function AudioIcon({ status }) {
    const playing = status === "playing";
    const loading = status === "loading";
    return (
        <div className="relative text-[var(--dict-icon)]">
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                className={loading ? "animate-spin-slow" : ""}
            >
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path
                    d="M8 10v4h2l3 3V7l-3 3H8z"
                    fill={playing ? "var(--dict-accent)" : "currentColor"}
                />
            </svg>
            {loading && (
                <span className="absolute inset-0 rounded-full ring-2 ring-[var(--dict-focus)] animate-ping opacity-60" />
            )}
        </div>
    );
}

function SearchIcon({ active }) {
    return (
        <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className={active ? "text-[var(--dict-accent)]" : "text-[var(--dict-icon)]"}
        >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <line
                x1="16"
                y1="16"
                x2="21"
                y2="21"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
            />
        </svg>
    );
}

function ChevronIcon({ open }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            style={{
                transition: "transform 0.2s",
                transform: open ? "rotate(0deg)" : "rotate(-90deg)",
            }}
        >
            <polyline
                points="6 8 10 12 14 8"
                stroke={open ? "var(--dict-accent)" : "var(--dict-icon)"}
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function splitWordsAndSeparators(text) {
    // Splits into word, punctuation, and whitespace tokens
    return text.match(/[\p{L}]+(?:-[\p{L}]+)*|[^\p{L}\s]+|\s+/gu);
}

const MAX_HISTORY = 256;

// helper for per-button status
const makeAudioKey = (idx, field) => `${idx}:${field}`;

export default function App() {
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [currentIdx, setCurrentIdx] = useState(-1);
    const [showHistoryPanel, setShowHistoryPanel] = useState(false);
    const [regenCooldown, setRegenCooldown] = useState(false);
    /** Bumps when a network define/regenerate starts so the input progress animation restarts. */
    const [progressCycle, setProgressCycle] = useState(0);

    // { [key]: 'loading' | 'playing' } – absence means 'idle'
    const [audioStatus, setAudioStatus] = useState({});
    const inputRef = useRef(null);
    const currentAudioRef = useRef(null);

    const setKeyStatus = (key, status) =>
        setAudioStatus((s) => ({ ...s, [key]: status }));
    const clearKeyStatus = (key) =>
        setAudioStatus((s) => {
            const { [key]: _, ...rest } = s;
            return rest;
        });

    useEffect(() => {
        setInput("");
        inputRef.current?.focus();
        const saved = localStorage.getItem("wordHistory");
        if (saved) {
            const arr = JSON.parse(saved);
            setHistory(arr);
            setCurrentIdx(arr.length ? arr.length - 1 : -1);
            setInput(arr.length ? arr[arr.length - 1].word : "");
        }
    }, []);

    useEffect(() => {
        localStorage.setItem("wordHistory", JSON.stringify(history));
    }, [history]);

    useEffect(() => {
        if (currentIdx >= 0 && history[currentIdx]) {
            setInput("");
            inputRef.current?.focus();
        }
    }, [currentIdx, history]);

    const handleAudioPlay = async (
        word,
        idx,
        field /* 'word' | 'explanation' | 'sentence' */
    ) => {
        const key = makeAudioKey(idx, field);
        // Lock only this specific icon while busy
        if (audioStatus[key] === "loading" || audioStatus[key] === "playing")
            return;

        // Map UI field name to server "type"
        const type = field === "sentence" ? "sample" : field; // server expects: word | explanation | sample
        setKeyStatus(key, "loading");

        try {
            const res = await fetch("/api/audio", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ word, type }), // only send the word + type
            });
            if (!res.ok) throw new Error("Audio not ready");

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);

            if (currentAudioRef.current) {
                currentAudioRef.current.pause();
            }
            const audio = new Audio(url);
            currentAudioRef.current = audio;

            audio.onended = () => {
                clearKeyStatus(key);
                URL.revokeObjectURL(url);
            };
            audio.onerror = () => {
                clearKeyStatus(key);
                URL.revokeObjectURL(url);
            };

            setKeyStatus(key, "playing");
            audio.play();
        } catch {
            clearKeyStatus(key);
            alert("Audio not available yet. Please try again soon.");
        }
    };

    function handleWordClick(word) {
        setInput(word);
        inputRef.current?.focus();
    }

    async function handleSubmit(e) {
        e.preventDefault();
        const word = input.trim();
        if (!word) return;

        const existingIdx = history.findIndex(
            (entry) => entry.word.toLowerCase() === word.toLowerCase()
        );

        if (existingIdx !== -1) {
            const entry = history[existingIdx];
            const newHistory = [
                ...history.slice(0, existingIdx),
                ...history.slice(existingIdx + 1),
                entry,
            ];
            setHistory(newHistory);
            setCurrentIdx(newHistory.length - 1);
            setInput("");
            inputRef.current?.focus();
            return;
        }

        setLoading(true);
        setProgressCycle((c) => c + 1);
        try {
            const resp = await fetch("/api/define", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ word }),
            });

            if (!resp.ok) throw new Error("API error");
            const data = await resp.json();

            const newEntry = {
                word: data.word,
                region: data.region,
                explanation: data.explanation,
                sentence: data.sentence,
            };
            const newHistory = [...history, newEntry].slice(-MAX_HISTORY);
            setHistory(newHistory);
            setCurrentIdx(newHistory.length - 1);
            setInput("");
        } catch {
            alert("Failed to fetch definition.");
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    }

    function handleClearHistory() {
        setHistory([]);
        setCurrentIdx(-1);
        setInput("");
        localStorage.removeItem("wordHistory");
        inputRef.current?.focus();
    }

    async function handleRegenerate() {
        if (regenCooldown || currentIdx < 0 || !history[currentIdx]) return;

        setRegenCooldown(true);
        setTimeout(() => setRegenCooldown(false), 5000);

        const word = history[currentIdx].word;
        setLoading(true);
        setProgressCycle((c) => c + 1);
        try {
            const resp = await fetch("/api/define", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ word, nocache: true }), // force bypass cache
            });
            if (!resp.ok) throw new Error("API error");
            const data = await resp.json();

            const newEntry = {
                word: data.word,
                region: data.region,
                explanation: data.explanation,
                sentence: data.sentence,
            };
            const newHistory = [...history];
            newHistory[currentIdx] = newEntry;
            setHistory(newHistory);
        } catch {
            alert("Failed to regenerate definition.");
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    }

    const wordData = currentIdx >= 0 ? history[currentIdx] : null;

    return (
        <div className="dict-app bg-[var(--dict-page)] min-h-screen flex flex-col p-6 font-serif text-[var(--dict-ink)]">
            <style>{`
                .dict-app {
                    --dict-page: #f8fafc;
                    --dict-ink: #1a2d45;
                    --dict-headline: #1e3a8a;
                    --dict-ink-muted: #4a6278;
                    --dict-border: #b9c9d9;
                    --dict-surface: #e8f0fa;
                    --dict-surface-highlight: #d8e6f6;
                    --dict-progress: #c8dcf0;
                    --dict-accent: #2563eb;
                    --dict-accent-soft: #dbeafe;
                    --dict-focus: #93c5fd;
                    --dict-icon: #64748b;
                    --dict-danger: #dc2626;
                    --dict-danger-soft: #fecaca;
                }
                .animate-spin-slow { animation: spin 1.2s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
                @keyframes inputProgressFill {
                    from { transform: scaleX(0); }
                    to { transform: scaleX(1); }
                }
                .input-progress-shade {
                    transform-origin: left center;
                    animation: inputProgressFill 2s linear forwards;
                }
                .dict-submit-btn {
                    border-color: var(--dict-ink);
                    color: var(--dict-ink);
                }
                .dict-submit-btn:hover:not(:disabled) {
                    background-color: var(--dict-accent-soft);
                }
                .dict-link-word {
                    cursor: pointer;
                    color: inherit;
                    user-select: text;
                }
                .dict-link-word:hover {
                    color: var(--dict-accent);
                }
                .dict-btn-danger-outline:hover {
                    background-color: color-mix(in srgb, var(--dict-danger) 10%, white);
                }
                .dict-btn-accent-outline {
                    border-color: var(--dict-accent);
                    color: var(--dict-accent);
                }
                .dict-btn-accent-outline:hover:not(:disabled) {
                    background-color: var(--dict-accent-soft);
                }
            `}</style>

            <div className="flex-shrink-0 w-full">
            <form className="flex gap-2 mb-5" onSubmit={handleSubmit}>
                <div
                    className="relative flex-1 min-w-0 rounded-md border bg-white overflow-hidden shadow-sm"
                    style={{ borderColor: "var(--dict-border)" }}
                >
                    {loading && (
                        <div
                            key={progressCycle}
                            className="input-progress-shade pointer-events-none absolute inset-y-0 left-0 w-full"
                            style={{ backgroundColor: "var(--dict-progress)" }}
                            aria-hidden
                        />
                    )}
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Enter a word"
                        value={input}
                        disabled={loading}
                        onChange={(e) => setInput(e.target.value)}
                        className="relative z-10 w-full text-lg px-3 py-2 bg-transparent border-0 outline-none focus:ring-2 focus:ring-[var(--dict-focus)] focus:ring-inset rounded-md placeholder:text-[var(--dict-icon)]"
                        style={{ color: "var(--dict-ink)" }}
                    />
                </div>
                <button
                    type="submit"
                    disabled={loading}
                    className="dict-submit-btn text-lg px-4 py-2 rounded-md border-2 font-medium bg-white disabled:opacity-60 transition-colors"
                >
                    <SearchIcon active={loading} />
                </button>
            </form>

            {wordData && (
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl font-bold" style={{ color: "var(--dict-headline)" }}>
                            {wordData.word}
                        </span>

                        {/* WORD audio */}
                        {(() => {
                            const key = makeAudioKey(currentIdx, "word");
                            const status = audioStatus[key];
                            const disabled =
                                status === "loading" || status === "playing";
                            return (
                                <button
                                    onClick={() =>
                                        handleAudioPlay(
                                            wordData.word,
                                            currentIdx,
                                            "word"
                                        )
                                    }
                                    className="w-8 h-8 flex items-center justify-center rounded-full border bg-white disabled:opacity-60 transition-colors hover:bg-[var(--dict-accent-soft)]"
                                    style={{ borderColor: "var(--dict-border)" }}
                                    type="button"
                                    aria-label="Play word"
                                    tabIndex={0}
                                    disabled={disabled}
                                >
                                    <AudioIcon status={status} />
                                </button>
                            );
                        })()}

                        {wordData.region !== "--" &&
                            wordData.region.length == 2 && (
                                <span
                                    className="inline-flex items-center justify-center rounded px-1 py-0.5 ml-3"
                                    style={{ backgroundColor: "var(--dict-accent-soft)" }}
                                >
                                    <CountryFlag
                                        countryCode={wordData.region}
                                        svg
                                        style={{
                                            width: "18px",
                                            height: "18px",
                                        }}
                                    />
                                </span>
                            )}
                    </div>

                    <div
                        className="rounded-lg px-4 py-3 mb-4 flex justify-between items-start"
                        style={{
                            backgroundColor: "var(--dict-surface)",
                            color: "var(--dict-headline)",
                        }}
                    >
                        <span>
                            {splitWordsAndSeparators(wordData.explanation).map(
                                (part, i) =>
                                    !/^[\s.,'";:!?-]+$/.test(part) ? (
                                        <span
                                            key={i}
                                            className="dict-link-word"
                                            onClick={() =>
                                                handleWordClick(part)
                                            }
                                            tabIndex={0}
                                        >
                                            {part}
                                        </span>
                                    ) : (
                                        part
                                    )
                            )}
                        </span>

                        {/* EXPLANATION audio */}
                        {(() => {
                            const key = makeAudioKey(currentIdx, "explanation");
                            const status = audioStatus[key];
                            const disabled =
                                status === "loading" || status === "playing";
                            return (
                                <button
                                    onClick={() =>
                                        handleAudioPlay(
                                            wordData.word,
                                            currentIdx,
                                            "explanation"
                                        )
                                    }
                                    className="ml-3 flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full border bg-white disabled:opacity-60 transition-colors hover:bg-[var(--dict-accent-soft)]"
                                    style={{ borderColor: "var(--dict-border)" }}
                                    type="button"
                                    aria-label="Play explanation"
                                    tabIndex={0}
                                    disabled={disabled}
                                >
                                    <AudioIcon status={status} />
                                </button>
                            );
                        })()}
                    </div>

                    <div
                        className="italic flex items-center"
                        style={{ color: "var(--dict-ink-muted)" }}
                    >
                        <span>
                            {splitWordsAndSeparators(wordData.sentence).map(
                                (part, i) => {
                                    if (
                                        part.toLowerCase() ===
                                        wordData.word.toLowerCase()
                                    ) {
                                        return (
                                            <span
                                                key={i}
                                                className="px-1 rounded font-medium dict-link-word"
                                                style={{
                                                    backgroundColor:
                                                        "var(--dict-surface-highlight)",
                                                    color: "var(--dict-headline)",
                                                }}
                                                onClick={() =>
                                                    handleWordClick(part)
                                                }
                                                tabIndex={0}
                                            >
                                                {part}
                                            </span>
                                        );
                                    } else if (!/^[\s.,'";:!?-]+$/.test(part)) {
                                        return (
                                            <span
                                                key={i}
                                                className="dict-link-word"
                                                onClick={() =>
                                                    handleWordClick(part)
                                                }
                                                tabIndex={0}
                                            >
                                                {part}
                                            </span>
                                        );
                                    } else {
                                        return part;
                                    }
                                }
                            )}
                        </span>

                        {/* SENTENCE audio */}
                        {(() => {
                            const key = makeAudioKey(currentIdx, "sentence");
                            const status = audioStatus[key];
                            const disabled =
                                status === "loading" || status === "playing";
                            return (
                                <button
                                    onClick={() =>
                                        handleAudioPlay(
                                            wordData.word,
                                            currentIdx,
                                            "sentence"
                                        )
                                    }
                                    className="ml-2 align-middle flex items-center justify-center w-8 h-8 rounded-full border bg-white disabled:opacity-60 transition-colors hover:bg-[var(--dict-accent-soft)]"
                                    style={{ borderColor: "var(--dict-border)" }}
                                    type="button"
                                    aria-label="Play sentence"
                                    tabIndex={0}
                                    disabled={disabled}
                                >
                                    <AudioIcon status={status} />
                                </button>
                            );
                        })()}
                    </div>
                </div>
            )}
            </div>

            <footer className="mt-auto w-full flex flex-col items-center pt-6 border-t shrink-0" style={{ borderColor: "var(--dict-border)" }}>
            <button
                onClick={() => setShowHistoryPanel((v) => !v)}
                className="flex items-center justify-center bg-white mb-2 transition-colors rounded-md hover:bg-[var(--dict-accent-soft)]"
                aria-label="Show more controls"
                type="button"
            >
                <ChevronIcon open={showHistoryPanel} />
            </button>

            {showHistoryPanel && (
                <div
                    className="w-full max-w-lg mx-auto rounded-lg p-3 mb-1 text-sm animate-fade-in border"
                    style={{
                        backgroundColor: "var(--dict-accent-soft)",
                        borderColor: "var(--dict-border)",
                        color: "var(--dict-ink)",
                    }}
                >
                    {history.length > 1 && (
                        <div className="flex gap-2 mt-1 items-center justify-center">
                            <button
                                onClick={() =>
                                    setCurrentIdx((idx) => Math.max(0, idx - 1))
                                }
                                disabled={currentIdx <= 0}
                                className="px-3 py-0 rounded border bg-white disabled:opacity-40 text-xs transition-colors hover:bg-[var(--dict-surface)]"
                                style={{ borderColor: "var(--dict-border)", color: "var(--dict-ink)" }}
                            >
                                ← Previous
                            </button>
                            <button
                                onClick={() =>
                                    setCurrentIdx((idx) =>
                                        Math.min(history.length - 1, idx + 1)
                                    )
                                }
                                disabled={currentIdx >= history.length - 1}
                                className="px-3 py-0 rounded border bg-white disabled:opacity-40 text-xs transition-colors hover:bg-[var(--dict-surface)]"
                                style={{ borderColor: "var(--dict-border)", color: "var(--dict-ink)" }}
                            >
                                Next →
                            </button>
                        </div>
                    )}

                    {history.length > 0 && (
                        <div className="flex flex-col gap-1 mt-3 items-center justify-center">
                            <div className="text-xs opacity-70" style={{ color: "var(--dict-ink-muted)" }}>
                                Showing {currentIdx + 1} of {history.length}{" "}
                                words in history
                            </div>
                            <div className="flex">
                                <button
                                    onClick={handleClearHistory}
                                    className="dict-btn-danger-outline w-fit mt-1 px-2 py-0 rounded border bg-white text-xs transition-colors"
                                    style={{
                                        borderColor: "var(--dict-danger-soft)",
                                        color: "var(--dict-danger)",
                                    }}
                                    type="button"
                                >
                                    Clear History
                                </button>
                                <button
                                    onClick={handleRegenerate}
                                    className="dict-btn-accent-outline w-fit mt-1 px-2 py-0 rounded border bg-white text-xs ml-2 transition-colors"
                                    type="button"
                                    disabled={currentIdx < 0 || loading || regenCooldown}
                                >
                                    Regenerate
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            </footer>
        </div>
    );
}

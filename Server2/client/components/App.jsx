import React, { useState, useRef, useEffect } from "react";

function AudioIcon({ playing }) {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#A0AEC0" strokeWidth="2" />
            <path
                d="M8 10v4h2l3 3V7l-3 3H8z"
                fill={playing ? "#f59e42" : "#A0AEC0"}
            />
        </svg>
    );
}

function splitWordsAndSeparators(text) {
    // Splits into word, punctuation, and whitespace tokens
    return text.match(/\w+|[^\w\s]+|\s+/g) || [];
}

const MAX_HISTORY = 256;

export default function App() {
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [currentIdx, setCurrentIdx] = useState(-1);
    const [playing, setPlaying] = useState({});
    const inputRef = useRef(null);
    const currentAudioRef = useRef(null);

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

    const handleAudioPlay = async (text, idx, field) => {
        setPlaying({ field, idx });
        try {
            const res = await fetch(
                `/api/audio?text=${encodeURIComponent(text)}`
            );
            if (!res.ok) throw new Error("Audio not ready");
            const url = res.url;
            if (currentAudioRef.current) currentAudioRef.current.pause();
            const audio = new Audio(url);
            currentAudioRef.current = audio;
            audio.play();
            audio.onended = () => setPlaying({});
            audio.onerror = () => setPlaying({});
        } catch {
            setPlaying({});
            alert("Audio not available yet. Please try again soon.");
        }
    };

    function handleWordClick(word) {
        if (!word || !/^\w+$/.test(word)) return;
        setInput(word);
        inputRef.current?.focus();
    }

    async function handleSubmit(e) {
        e.preventDefault();
        const word = input.trim();
        if (!word) return;
        setLoading(true);

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
            setLoading(false);
            inputRef.current?.focus();
            return;
        }

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
        if (currentIdx < 0 || !history[currentIdx]) return;
        const word = history[currentIdx].word;
        setLoading(true);
        try {
            const resp = await fetch("/api/define", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ word, nocache: true }), // force bypass cache
            });
            if (!resp.ok) throw new Error("API error");
            const data = await resp.json();

            // Replace the current entry with new data
            const newEntry = {
                word: data.word,
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
        <div className="bg-gray-100 min-h-screen p-6 font-serif">
            <form className="flex gap-2 mb-5" onSubmit={handleSubmit}>
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Enter a word"
                    value={input}
                    disabled={loading}
                    onChange={(e) => setInput(e.target.value)}
                    className="text-lg px-3 py-2 rounded border border-slate-300 flex-1"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="text-lg px-4 py-2 rounded border-2 border-blue-800 text-blue-800 font-medium bg-white hover:bg-blue-50 disabled:opacity-60"
                >
                    {loading ? "..." : "Explain"}
                </button>
            </form>

            {wordData && (
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl font-bold text-blue-900">
                            {wordData.word}
                        </span>
                        <button
                            onClick={() =>
                                handleAudioPlay(
                                    wordData.word,
                                    currentIdx,
                                    "word"
                                )
                            }
                            className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-orange-50"
                            type="button"
                            aria-label="Play word"
                            tabIndex={0}
                        >
                            <AudioIcon
                                playing={
                                    playing.field === "word" &&
                                    playing.idx === currentIdx
                                }
                            />
                        </button>
                    </div>

                    <div className="bg-blue-100 text-blue-900 rounded px-4 py-3 mb-4 flex justify-between items-start">
                        <span>
                            {splitWordsAndSeparators(wordData.explanation).map((part, i) =>
                                /^\w+$/.test(part) ? (
                                    <span
                                        key={i}
                                        className="cursor-pointer hover:underline hover:text-orange-500"
                                        onClick={() => handleWordClick(part)}
                                        tabIndex={0}
                                        style={{ userSelect: "text" }}
                                    >
                                        {part}
                                    </span>
                                ) : (
                                    part
                                )
                            )}
                        </span>                        
                        <button
                            onClick={() =>
                                handleAudioPlay(
                                    wordData.explanation,
                                    currentIdx,
                                    "explanation"
                                )
                            }
                            className="ml-3 flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-orange-50"
                            type="button"
                            aria-label="Play explanation"
                            tabIndex={0}
                        >
                            <AudioIcon
                                playing={
                                    playing.field === "explanation" &&
                                    playing.idx === currentIdx
                                }
                            />
                        </button>
                    </div>

                    <div className="italic text-gray-600 flex items-center">
                      <span>
                          {splitWordsAndSeparators(wordData.sentence).map((part, i) => {
                              // Highlight target word as before
                              if (part.toLowerCase() === wordData.word.toLowerCase()) {
                                  return (
                                      <span
                                          key={i}
                                          className="bg-blue-50 px-1 rounded text-blue-800 font-medium cursor-pointer hover:underline"
                                          onClick={() => handleWordClick(part)}
                                          tabIndex={0}
                                          style={{ userSelect: "text" }}
                                      >
                                          {part}
                                      </span>
                                  );
                              } else if (/^\w+$/.test(part)) {
                                  return (
                                      <span
                                          key={i}
                                          className="cursor-pointer hover:underline hover:text-orange-500"
                                          onClick={() => handleWordClick(part)}
                                          tabIndex={0}
                                          style={{ userSelect: "text" }}
                                      >
                                          {part}
                                      </span>
                                  );
                              } else {
                                  return part;
                              }
                          })}
                      </span>
                        <button
                            onClick={() =>
                                handleAudioPlay(
                                    wordData.sentence,
                                    currentIdx,
                                    "sentence"
                                )
                            }
                            className="ml-2 align-middle flex items-center justify-center w-8 h-8 rounded-full border border-slate-300 bg-white hover:bg-orange-50"
                            type="button"
                            aria-label="Play sentence"
                            tabIndex={0}
                        >
                            <AudioIcon
                                playing={
                                    playing.field === "sentence" &&
                                    playing.idx === currentIdx
                                }
                            />
                        </button>
                    </div>
                </div>
            )}

            {history.length > 1 && (
                <div className="flex gap-2 mt-4">
                    <button
                        onClick={() =>
                            setCurrentIdx((idx) => Math.max(0, idx - 1))
                        }
                        disabled={currentIdx <= 0}
                        className="px-3 py-0 rounded border bg-white text-blue-900 disabled:opacity-40 text-xs"
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
                        className="px-3 py-0 rounded border bg-white text-blue-900 disabled:opacity-40 text-xs"
                    >
                        Next →
                    </button>
                </div>
            )}

            {history.length > 0 && (
                <div className="flex flex-col gap-1 mt-3">
                    <div className="text-xs text-gray-400">
                        Showing {currentIdx + 1} of {history.length} words in
                        history
                    </div>
                    <div className="flex">
                      <button
                          onClick={handleClearHistory}
                          className="w-fit mt-1 px-2 py-0 rounded border border-red-300 text-red-300 bg-white text-xs hover:bg-red-30"
                          type="button"
                      >
                          Clear History
                      </button>
                      <button
                          onClick={handleRegenerate}
                          className="w-fit mt-1 px-2 py-0 rounded border border-orange-400 text-orange-400 bg-white text-xs hover:bg-orange-50 ml-2"
                          type="button"
                          disabled={currentIdx < 0 || loading}
                      >
                          Regenerate
                      </button>
                    </div>
                </div>
            )}
        </div>
    );
}

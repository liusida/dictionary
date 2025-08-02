import os
import json
from flask import Flask, request, render_template, jsonify, send_file
from openai import OpenAI
from dotenv import load_dotenv
import re
import sqlite3
from contextlib import closing

# Load API key from .env
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_APIKEY"))

DB_FILE = "cache.db"

def init_db():
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS cache (
                word TEXT PRIMARY KEY,
                explanation TEXT,
                sample_sentence TEXT
            )
        ''')
init_db()

app = Flask(__name__)

CACHE_FILE = "cache.json"

# Load or create cache
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE, "r") as f:
        cache = json.load(f)
else:
    cache = {}

# Prompt template
PROMPT_TEMPLATE = """
Please explain the English word "{word}" in the style of Vocabulary.com, simple and concise. Your response must be in JSON format with the following fields:

- "word": the word itself  
- "explanation": an intuitive, student-friendly description or analogy  
- "sample_sentence": a clear example sentence using the word naturally in context

Keep the tone engaging and easy to understand.
"""

def extract_json_from_response(text):
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        return match.group(0)
    return '{}'

def query_openai(word):
    prompt = PROMPT_TEMPLATE.format(word=word)
    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini-2025-04-14",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )
        content = response.choices[0].message.content
        json_str = extract_json_from_response(content)
        data = json.loads(json_str)
        return data.get("explanation", ""), data.get("sample_sentence", "")
    except Exception as e:
        return f"(API error: {e})", ""

@app.route("/", methods=["GET"])
def index():
    word = request.args.get("word", "").strip().lower()

    # If no word, just render normal page
    if not word:
        return render_template("index.html", word=None)

    # Otherwise it'll be browser without javascript support
    explanation, sample_sentence = get_cached_word(word)
    if not explanation:
        explanation, sample_sentence = query_openai(word)
        if explanation:
            set_cached_word(word, explanation, sample_sentence)

    return render_template(
        "nojs.html",
        word=word,
        explanation=explanation,
        sample_sentence=sample_sentence,
    )

@app.route("/word/<word>", methods=["GET"])
def word_page(word):
    return render_template("index.html", word=word)

def get_cached_word(word):
    with sqlite3.connect(DB_FILE) as conn:
        cur = conn.execute("SELECT explanation, sample_sentence FROM cache WHERE word = ?", (word,))
        row = cur.fetchone()
        return row if row else (None, None)

def set_cached_word(word, explanation, sample_sentence):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO cache (word, explanation, sample_sentence) VALUES (?, ?, ?)",
            (word, explanation, sample_sentence)
        )

@app.route("/lookup", methods=["POST"])
def lookup():
    word = request.json.get("word", "").strip().lower()
    explanation = ""
    sample_sentence = ""
    if word:
        explanation, sample_sentence = get_cached_word(word)
        if not explanation:
            explanation, sample_sentence = query_openai(word)
            set_cached_word(word, explanation, sample_sentence)
        # Highlight the word in the sample sentence (case-insensitive, word boundaries)
        if sample_sentence:
            pattern = re.compile(rf'(\b{re.escape(word)}\b)', re.IGNORECASE)
            sample_sentence = pattern.sub(r'<span class="highlight">\1</span>', sample_sentence)
    return jsonify({
        "word": word,
        "explanation": explanation,
        "sample_sentence": sample_sentence
    })

@app.route("/audio/<word>")
@app.route("/audio/<word>.mp3")
def generate_audio(word):
    audio_dir = os.path.join("static", "audio")
    audio_path = os.path.join(audio_dir, f"{word}.mp3")
    # Ensure the directory exists
    os.makedirs(audio_dir, exist_ok=True)
    if not os.path.exists(audio_path):
        response = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            input=word,
            voice="alloy"
        )
        with open(audio_path, "wb") as f:
            f.write(response.content)

    return send_file(audio_path, mimetype="audio/mpeg")

@app.route("/audio/sample/<word>")
@app.route("/audio/sample/<word>.mp3")
def generate_sample_audio(word):
    # Get the sample sentence from the cache/db
    with sqlite3.connect(DB_FILE) as conn:
        cur = conn.execute("SELECT sample_sentence FROM cache WHERE word = ?", (word.lower(),))
        row = cur.fetchone()
        if not row or not row[0]:
            return "Sample sentence not found", 404
        sample_sentence = row[0]

    # File path for sentence audio
    audio_dir = os.path.join("static", "audio", "samples")
    os.makedirs(audio_dir, exist_ok=True)
    audio_path = os.path.join(audio_dir, f"{word.lower()}.mp3")

    if not os.path.exists(audio_path):
        response = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            input=sample_sentence,
            voice="alloy"
        )
        with open(audio_path, "wb") as f:
            f.write(response.content)

    return send_file(audio_path, mimetype="audio/mpeg")

@app.route("/audio/explanation/<word>")
@app.route("/audio/explanation/<word>.mp3")
def generate_explanation_audio(word):
    # Get the explanation from the cache/db
    with sqlite3.connect(DB_FILE) as conn:
        cur = conn.execute("SELECT explanation FROM cache WHERE word = ?", (word.lower(),))
        row = cur.fetchone()
        if not row or not row[0]:
            return "Explanation not found", 404
        explanation = row[0]

    audio_dir = os.path.join("static", "audio", "explanations")
    os.makedirs(audio_dir, exist_ok=True)
    audio_path = os.path.join(audio_dir, f"{word.lower()}.mp3")

    if not os.path.exists(audio_path):
        response = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            input=explanation,
            voice="alloy"
        )
        with open(audio_path, "wb") as f:
            f.write(response.content)

    return send_file(audio_path, mimetype="audio/mpeg")

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5080, debug=True)

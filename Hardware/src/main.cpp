#include <Arduino.h>
#include <ArduinoJson.h>

#define AUDIO_NO_SD_FS
#include "Audio.h"

#include "manage_network.h"
#include "manage_keyboard.h"
#include "manage_oled.h"
#include "manage_epaper.h"
// #include "manage_sound.h"
#include "pins.h"
#include "shared_globals.h"

// ESP32-S3-box uses Serial0
// #define Serial Serial0

bool isBLEKeyboardConnected = false;

unsigned long lastBLEKeepAlive = 0;
const unsigned long KEEP_BLE_ALIVE_INTERVAL = 10000; // 10 seconds

ManageOLED oled_display(&Serial);
ManageEPaper epaper_display(&Serial);
ManageKeyboard keyboard(&Serial);
ManageNetwork network(&Serial);
// ManageSound sound(&Serial);
Audio audio;
// Device 1: 23:11:13:13:00:0f | Name: M7
volatile AudioType nextPlayingAudioType = AUDIO_NONE;

volatile bool wordReady = false;
char currentWord[256] = "";
char wordToLookup[256] = "";


//==
void setup() {
    Serial.begin(115200);
    Serial.println("Serial begin.");
    print_heap_size();    

    pinMode(PIN_OLED_CS, OUTPUT);
    pinMode(PIN_EPAPER_CS, OUTPUT);

    SPI.begin(PIN_SPI_SCLK, PIN_SPI_MISO, PIN_SPI_MOSI);
    oled_print("SPI begin.");
    
    oled_display.init();
    epaper_display.init();

    oled_print("Connect WiFi...");
    network.init("StarLab_2.4G", "1234567891");

    oled_print("Init Keyboard...");
    keyboard.init();

    Serial.println("Init Sound...");
    // sound.init(PIN_SOUND_BCLK, PIN_SOUND_LRC, PIN_SOUND_DIN, PIN_SOUND_SD); // BCLK, RC/LRC, DIN
    audio.setPinout(PIN_SOUND_BCLK, PIN_SOUND_LRC, PIN_SOUND_DIN);
    audio.setVolume(18); // default 0...21
    audio.forceMono(true);

    oled_print("Search for Keyboard...");
    oled_print("Press any key...");
    keyboard.connectToFirstMatching("M7");
    if (keyboard.isConnected()) {
        oled_print("Enter a word.");
    }
    network.lookupWord("apple"); // to warm up
    epaper_display.clear(); // clean the e-paper
    
    // Play Test Sound
    // sound.playTestTone(500, 100, 10000);    // Default 1kHz for 500ms
}

void beep() {
    // if (sound.isInitialized()) {
    //     sound.playTestTone(500, 100, 10000);    // Default 1kHz for 500ms
    // } else {
    //     Serial.println("Error: try to beep before initialization.");
    // }
}

void loop() {
    if (!keyboard.isConnected()) {
        oled_print("Press any key...");
        keyboard.connectToFirstMatching("M7");
        if (keyboard.isConnected()) {
            oled_print("");
        } else {
            delay(1000);
        }
    }
    // Keep-alive logic
    unsigned long currentMillis = millis();
    if (keyboard.isConnected() && currentMillis - lastBLEKeepAlive > KEEP_BLE_ALIVE_INTERVAL) {
        keyboard.sendKeepAlive();
        lastBLEKeepAlive = currentMillis;
    }

    if (wordReady) {
        beep();
        wordReady = false;
        oled_print(".");
        if (strcmp(wordToLookup, "reset") == 0) {
            ESP.restart();
        }
        String response = network.lookupWord(wordToLookup);
        // Parse the JSON response and extract "word", "explanation", and "sample_sentence"
        JsonDocument doc;
        oled_print("..");
        DeserializationError error = deserializeJson(doc, response);
        if (!error) {
            const char* word = doc["word"] | "";
            const char* explanation = doc["explanation"] | "";
            const char* sample_sentence = doc["sample_sentence"] | "";

            epaper_display.setWord(word);
            epaper_display.setExplanation(explanation);
            // epaper_display.setSampleSentence("");
            epaper_display.setSampleSentence(sample_sentence);
            oled_print("...");
            epaper_display.draw();
            oled_print("");
            audio.stopSong();
            String url = network.getAudioMp3URL( word, AUDIO_WORD );
            audio.connecttohost(url.c_str());
            nextPlayingAudioType = AUDIO_NONE;
        }
    }
    if (nextPlayingAudioType != AUDIO_NONE) {
        if (strlen(wordToLookup)>0 && network.isInitialized()) {
            oled_print(">");
            audio.stopSong();
            oled_print(">>");
            String url = network.getAudioMp3URL( wordToLookup, nextPlayingAudioType );
            oled_print(">>>");
            audio.connecttohost(url.c_str());
            nextPlayingAudioType = AUDIO_NONE;
            oled_print("");
        }    
    }
    audio.loop();
    vTaskDelay(1);
}

// Show msg on the OLED display
void oled_print(const char* msg) {
    if (oled_display.isInitialized()) {
        oled_display.print(msg);
    }
    Serial.print(msg);    
}

void print_heap_size() {
    if (Serial) {
        Serial.println("Free heap: " + String(ESP.getFreeHeap()));
    }
}

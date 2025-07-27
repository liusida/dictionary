#include <Arduino.h>
#include <ArduinoJson.h>

#include "manage_network.h"
#include "manage_keyboard.h"
#include "manage_oled.h"
#include "manage_epaper.h"
#include "pins.h"
#include "shared_globals.h"


volatile bool wordReady = false;
char currentWord[256] = "";
char wordToLookup[256] = "";

bool isBLEKeyboardConnected = false;

unsigned long lastBLEKeepAlive = 0;
const unsigned long KEEP_BLE_ALIVE_INTERVAL = 10000; // 10 seconds

ManageOLED o(&Serial0);
ManageEPaper p(&Serial0);
ManageKeyboard k(&Serial0);
ManageNetwork m(&Serial0);
// Device 1: 23:11:13:13:00:0f | Name: M7


//==
void setup() {
    Serial0.begin(115200);
    Serial0.println("Serial0 begin.");

    pinMode(PIN_OLED_CS, OUTPUT);
    pinMode(PIN_EPAPER_CS, OUTPUT);

    SPI.begin(PIN_SPI_SCLK, PIN_SPI_MISO, PIN_SPI_MOSI);
    Serial0.println("SPI begin.");

    // setupKeyboard();
    o.init();
    p.init();

    oled_print("Connect WiFi...");
    m.connectWiFi("StarLab_2.4G", "1234567891");
    // m.setBaseURL("https://dict.liusida.com");
    m.setBaseURL("https://38.54.100.84");
    oled_print("WiFi connected.");

    oled_print("Init BLE...");
    k.init();
    // oled_print("Scan BLE...");
    // k.scanDevices(1);
    oled_print("Connect BLE...");
    k.connectToFirstMatching("M7");

    oled_print("Enter a word.");
    m.lookupWord("apple"); // to warm up
    p.clear(); // clean the e-paper
}


void loop() {
    if (!k.isConnected()) {
        oled_print("Connect Keyboard...");
        k.connectToFirstMatching("M7");
        oled_print("");
    }
    // Keep-alive logic
    unsigned long currentMillis = millis();
    if (k.isConnected() && currentMillis - lastBLEKeepAlive > KEEP_BLE_ALIVE_INTERVAL) {
        k.sendKeepAlive();
        lastBLEKeepAlive = currentMillis;
    }

    if (wordReady) {
        wordReady = false;
        oled_print(".");
        String response = m.lookupWord(wordToLookup);
        // Parse the JSON response and extract "word", "explanation", and "sample_sentence"
        JsonDocument doc;
        oled_print("..");
        DeserializationError error = deserializeJson(doc, response);
        if (!error) {
            const char* word = doc["word"] | "";
            const char* explanation = doc["explanation"] | "";
            const char* sample_sentence = doc["sample_sentence"] | "";

            p.setWord(word);
            p.setExplanation(explanation);
            p.setSampleSentence("");
            // p.setSampleSentence(sample_sentence);
            oled_print("...");
            p.draw();
            oled_print("");
        }
    }
    delay(10);
}

void oled_print(const char* msg) {
    o.print(msg);
}

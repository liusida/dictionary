#include "manage_network.h"
#include "shared_globals.h"

ManageNetwork::ManageNetwork(Stream *logOutput) : Loggable(logOutput), baseURL(nullptr) {}

void ManageNetwork::init(const char* ssid, const char* password, const char* baseAPIURL) {
    connectWiFi(ssid, password);
    setBaseURL(baseAPIURL);
    Device::init();
}

void ManageNetwork::connectWiFi(const char* ssid, const char* password) {
    if (WiFi.status() == WL_CONNECTED) {
        return;
    }
    WiFi.begin(ssid, password);
    
    unsigned long startAttemptTime = millis();
    const unsigned long wifiTimeout = 15000; // 15 seconds timeout

    while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < wifiTimeout) {
        delay(500);
    }
}

void ManageNetwork::setBaseURL(const char* baseAPIURL) {
    if (baseURL) {
        free(baseURL);
    }
    baseURL = strdup(baseAPIURL);
    log("Base URL: " + String(baseURL));
}

String ManageNetwork::lookupWord(const String& word) {
    if (WiFi.status() != WL_CONNECTED) {
        log("lookupWord: Not connected to WiFi");
        return "Not connected to WiFi";
    }
    if (!baseURL) {
        log("lookupWord: baseURL is null");
        return "Error";
    }    
    HTTPClient http;
    String url = String(baseURL) + "/lookup";
    http.begin(url);
    http.addHeader("Host", "dict.liusida.com");
    http.addHeader("Content-Type", "application/json");
    String postData = "{\"word\":\"" + word + "\"}";
    int httpCode = http.POST(postData);
    String payload;
    if (httpCode > 0) {
        payload = http.getString();
    } else {
        payload = "";
    }
    http.end();
    return payload;
}

String urlencode(const char* str) {
    String encoded = "";
    char c;
    char buf[4];
    while ((c = *str++)) {
        if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            encoded += c;
        } else {
            sprintf(buf, "%%%02X", (unsigned char)c);
            encoded += buf;
        }
    }
    return encoded;
}

String ManageNetwork::getAudioMp3URL(const char* word, AudioType type) const {
    if (!word || !*word) return "";

    String url = String(baseURL) + "/api/audio/stream?word=";
    url += urlencode(word);                  // use the helper we added
    url += "&type=";

    switch (type) {
        case AUDIO_WORD:         url += "word"; break;
        case AUDIO_EXPLANATION:  url += "explanation"; break;
        case AUDIO_SAMPLE:       url += "sample"; break;
        default:                 url += "word"; break;
    }
    return url;
}

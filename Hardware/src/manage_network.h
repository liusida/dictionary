#ifndef MANAGE_NETWORK_H
#define MANAGE_NETWORK_H

#include <WiFi.h>
#include <HTTPClient.h>

#include "loggable.h"
#include "device.h"
#include "shared_globals.h"

class ManageNetwork : public Loggable, public Device {
public:
    ManageNetwork(Stream *logOutput = nullptr);
    void init(const char* ssid, const char* password, const char* baseAPIURL="https://38.54.100.84"); // Using domain name slows first time request down quite a lot.
    void connectWiFi(const char* ssid, const char* password);
    void setBaseURL(const char* baseAPIURL);
    const char* getBaseURL() const { return baseURL; }
    String getAudioMp3URL(const char* word, AudioType type) const;
    String lookupWord(const String& word);
private:
    char* baseURL;
};

#endif // MANAGE_NETWORK_H

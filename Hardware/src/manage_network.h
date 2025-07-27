#ifndef MANAGE_NETWORK_H
#define MANAGE_NETWORK_H

#include <WiFi.h>
#include <HTTPClient.h>

#include "loggable.h"

class ManageNetwork : public Loggable {
public:
    ManageNetwork(Stream *logOutput = nullptr);
    void connectWiFi(const char* ssid, const char* password);
    void setBaseURL(const char* baseAPIURL);
    String lookupWord(const String& word);
private:
    char* baseURL;
};

#endif // MANAGE_NETWORK_H

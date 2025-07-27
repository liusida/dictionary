#ifndef MANAGE_KEYBOARD_H
#define MANAGE_KEYBOARD_H

#include <Arduino.h>
#include <NimBLEDevice.h>

#include "loggable.h"

class ManageKeyboard : public Loggable
{
public:
    ManageKeyboard(Stream *logOutput = nullptr);
    void init();                           // initialize BLE
    void scanDevices(int durationSec = 5); // scan for keyboards
    void connectToFirstMatching(const std::string &targetName, int durationSec = 2);
    bool connectToMac(const std::string &targetMac);
    bool connectToLastDevice();
    inline bool isConnected() const {
        return pClient && pClient->isConnected();
    }
    void sendKeepAlive();
    
private:
    void onKeyNotify(NimBLERemoteCharacteristic *chr, uint8_t *data, size_t length, bool isNotify);

private:
    NimBLEClient *pClient;
    NimBLERemoteCharacteristic *pInputChar;
};

#endif
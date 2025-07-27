#include "manage_keyboard.h"

static const char unshifted[128] = {
    0, 0, 0, 0, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
    'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '\n', 0, 0, '\t', ' ',
    '-', '=', '[', ']', '\\', '#', ';', '\'', '`', ',', '.', '/'};

static const char shifted[128] = {
    0, 0, 0, 0, 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
    'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '\n', 0, 0, '\t', ' ',
    '_', '+', '{', '}', '|', '~', ':', '"', '~', '<', '>', '?'};

ManageKeyboard::ManageKeyboard(Stream *logOutput)
    : Loggable(logOutput), pClient(nullptr), pInputChar(nullptr) {}

void ManageKeyboard::init()
{
    NimBLEDevice::init("ESP32-Host");
    log("BLE Initialized.");
}

void ManageKeyboard::scanDevices(int durationSec)
{
    log("TODO: Scanning for BLE devices...");

    // BLEScan *pBLEScan = BLEDevice::getScan();
    // pBLEScan->setActiveScan(true); // get scan results faster
    // BLEScanResults foundDevices = pBLEScan->start(durationSec);

    // int count = foundDevices.getCount();
    // log("Devices found: ", count);

    // for (int i = 0; i < count; i++)
    // {
    //     BLEAdvertisedDevice device = foundDevices.getDevice(i);
    //     log("Device ", i);
    //     log("\tMac: ", device.getAddress().toString().c_str());
    //     log("\tName: ", device.getName().c_str());
    // }

    // pBLEScan->clearResults(); // free memory
}

void ManageKeyboard::connectToMac(const std::string &targetMac)
{
    log("Connecting to: ", targetMac.c_str());

    NimBLEAddress address(targetMac, 0);
    pClient = NimBLEDevice::createClient();

    if (!pClient->connect(address))
    {
        log("❌ Failed to connect.");
        return;
    }

    log("✅ Connected to keyboard!");
    if (!pClient->discoverAttributes())
    {
        Serial.println("❌ Discovery failed.");
        pClient->disconnect();
        return;
    }

    NimBLERemoteService *hid = pClient->getService("1812");
    if (!hid)
    {
        Serial.println("❌ HID service missing.");
        pClient->disconnect();
        return;
    }

    for (auto *chr : hid->getCharacteristics())
    {
        if (chr->canNotify())
        {
            pInputChar = chr;
            break;
        }
    }

    if (!pInputChar || !pInputChar->subscribe(true,
                                            [this](NimBLERemoteCharacteristic *chr, uint8_t *data, size_t len, bool isNotify)
                                            {
                                                this->onKeyNotify(chr, data, len, isNotify);
                                            }))
    {
        Serial.println("❌ Subscription failed.");
        pClient->disconnect();
        return;
    }

    Serial.println("📬 Subscribed to HID input.");
    NimBLERemoteCharacteristic *ctrlPoint = hid->getCharacteristic("2A4C");
    if (ctrlPoint && ctrlPoint->canWrite())
    {
        uint8_t zero = 0x00;
        ctrlPoint->writeValue(&zero, 1, false);
        Serial.println("📤 Wrote 0x00 to HID Control Point");
    }
}

void ManageKeyboard::onKeyNotify(NimBLERemoteCharacteristic *chr, uint8_t *pData, size_t length, bool isNotify)
{
    log(".");

    if (length < 3)
        return;

    bool shift = pData[0] & 0x22; // left/right shift bits
    for (int i = 2; i < 8; i++)
    {
        uint8_t keycode = pData[i];
        if (keycode != 0 && keycode < 128)
        {
            char c = shift ? shifted[keycode] : unshifted[keycode];
            if (c)
            {
                log("Key pressed: ", String(c));
                // TODO: append to currentWord
            }
        }
    }
}
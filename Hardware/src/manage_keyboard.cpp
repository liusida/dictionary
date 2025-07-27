#include "manage_keyboard.h"
#include "shared_globals.h"

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
    NimBLEDevice::setSecurityAuth(true, true, true);  // bonding, MITM, secure
    log("BLE Initialized.");
}

void ManageKeyboard::scanDevices(int durationSec)
{
    log("🔍 Scanning BLE devices...");

    NimBLEScan *scan = NimBLEDevice::getScan();
    scan->setActiveScan(true);
    NimBLEScanResults results = scan->getResults(durationSec * 1000, false);
    // Output only the device with the strongest signal (highest RSSI)
    int maxRssi = -999;
    const NimBLEAdvertisedDevice* strongestDev = nullptr;
    for (int i = 0; i < results.getCount(); ++i)
    {
        const NimBLEAdvertisedDevice *dev = results.getDevice(i);
        int rssi = dev->getRSSI();
        if (strongestDev == nullptr || rssi > maxRssi) {
            maxRssi = rssi;
            strongestDev = dev;
        }
    }
    if (strongestDev) {
        log("Strongest Device:");
        log("\tMAC: ", strongestDev->getAddress().toString().c_str());
        log("\tName: ", strongestDev->getName().c_str());
        log("\tRSSI: ", maxRssi);
    } else {
        log("No BLE devices found.");
    }

    scan->clearResults();
}

bool ManageKeyboard::connectToMac(const std::string &targetMac)
{
    log("🔗 Connecting to: ", targetMac.c_str());

    // Construct with address type required
    NimBLEAddress address(targetMac, 0);
    pClient = NimBLEDevice::createClient();

    if (!pClient->connect(address))
    {
        log("❌ Failed to connect.");
        return false;
    }
    log("✅ Connected!");
    oled_print("Pair Keyboard...");
    
    log("discoverAttributes");
    if (!pClient->discoverAttributes())
    {
        log("❌ Discovery failed.");
        pClient->disconnect();
        return false;
    }
    log("getService");
    NimBLERemoteService *hid = pClient->getService("1812");
    if (!hid)
    {
        log("❌ HID service missing.");
        pClient->disconnect();
        return false;
    }
    log("getCharacteristic");
    pInputChar = hid->getCharacteristic("2A4D");
    if (!pInputChar || !pInputChar->canNotify())
    {
        log("❌ Input Report not found or cannot notify.");
        pClient->disconnect();
        return false;
    }
    log("subscribe");
    bool ok = pInputChar->subscribe(true,
                                    [this](NimBLERemoteCharacteristic *chr, uint8_t *data, size_t len, bool isNotify)
                                    {
                                        this->onKeyNotify(chr, data, len, isNotify);
                                    });
    if (!ok)
    {
        log("❌ Subscribe failed.");
        pClient->disconnect();
        return false;
    }
    log("📬 Subscribed to HID input report.");

    NimBLERemoteCharacteristic *ctrl = hid->getCharacteristic("2A4C");
    if (ctrl && ctrl->canWrite())
    {
        uint8_t zero = 0x00;
        ctrl->writeValue(&zero, 1, false);
        log("📤 Wrote 0x00 to HID Control Point");
    }
    return true;
}
bool ManageKeyboard::connectToLastDevice() {
    size_t count = NimBLEDevice::getNumBonds();
    if (count == 0) {
        log("No bonded devices found.");
        return false;
    }
    
    for (size_t i = 0; i < count; ++i) {
        NimBLEAddress addr = NimBLEDevice::getBondedAddress(i);
        log("Trying bonded device: ", addr.toString().c_str());
        if (connectToMac(addr.toString())) {
            log("Connected to bonded device!");
            return true;
        }
    }
    
    log("Failed to connect to any bonded device.");
    return false;
}

void ManageKeyboard::connectToFirstMatching(const std::string &targetName, int durationSec)
{
    log("🔍 Scanning for BLE devices matching: ", targetName.c_str());

    NimBLEScan *scan = NimBLEDevice::getScan();
    scan->setActiveScan(true);
    NimBLEScanResults results = scan->getResults(durationSec * 1000, false);

    int maxRssi = -999;
    const NimBLEAdvertisedDevice* bestMatch = nullptr;
    for (int i = 0; i < results.getCount(); ++i)
    {
        const NimBLEAdvertisedDevice *dev = results.getDevice(i);
        if (dev->getName() == targetName)
        {
            int rssi = dev->getRSSI();
            if (bestMatch == nullptr || rssi > maxRssi) {
                maxRssi = rssi;
                bestMatch = dev;
            }
        }
    }

    if (bestMatch)
    {
        log("Found device: ", bestMatch->getAddress().toString().c_str());
        connectToMac(bestMatch->getAddress().toString());
    }
    else
    {
        log("❌ No matching BLE device found.");
    }

    scan->clearResults();
}

void ManageKeyboard::sendKeepAlive() {
    // Send a "no key" report (all zeros)
    uint8_t nullReport[8] = {0};
    if (pInputChar && pInputChar->canWrite()) {
        pInputChar->writeValue(nullReport, sizeof(nullReport), false);
    }
}

void ManageKeyboard::onKeyNotify(NimBLERemoteCharacteristic *chr, uint8_t *pData, size_t length, bool isNotify) {
    if (length < 3) return;

    bool shift = (pData[0] & 0x22) != 0;

    for (int i = 2; i < 8; i++) {
        uint8_t keycode = pData[i];
        if (keycode == 0) continue;

        if (keycode == 0x2A) {  // Backspace
            size_t len = strnlen(currentWord, sizeof(currentWord));
            if (len > 0) currentWord[len - 1] = '\0';
            oled_print(currentWord);
            continue;
        }

        if (keycode == 0x28) {  // Enter
            strncpy(wordToLookup, currentWord, sizeof(wordToLookup));
            wordReady = true;
            currentWord[0] = '\0';
            continue;
        }

        if (keycode < 128) {
            char c = shift ? shifted[keycode] : unshifted[keycode];
            if (c) {
                size_t len = strnlen(currentWord, sizeof(currentWord) - 1);
                if (len < sizeof(currentWord) - 1) {
                    currentWord[len] = c;
                    currentWord[len + 1] = '\0';
                }
                oled_print(currentWord);
            }
        }
    }
    
}

#include <Arduino.h>
#include <unity.h>
#include <NimBLEDevice.h>
#include <Preferences.h>

Preferences prefs;
NimBLEClient *pClient = nullptr;
NimBLERemoteCharacteristic *pInputChar = nullptr;
BLEAddress bondedAddr;
bool hasBondedAddr = false;

#define SCAN_INTERVAL_MS  30000
#define SCAN_DURATION_SEC 5

void saveBondedAddress(const NimBLEAddress &addr) {
    prefs.begin("bonding", false);
    prefs.putString("keyboard", addr.toString().c_str());
    prefs.end();
}

bool loadBondedAddress() {
    prefs.begin("bonding", true);
    String addrStr = prefs.getString("keyboard", "");
    prefs.end();
    if (addrStr.length() > 0) {
        bondedAddr = NimBLEAddress(addrStr.c_str(), BLE_ADDR_PUBLIC);
        return true;
    }
    return false;
}

void test_load_and_save_bonded_address() {
    // Dummy address for testing
    NimBLEAddress dummy("11:22:33:44:55:66", BLE_ADDR_PUBLIC);
    saveBondedAddress(dummy);

    bool loaded = loadBondedAddress();
    TEST_ASSERT_TRUE(loaded);
    TEST_ASSERT_EQUAL_STRING(dummy.toString().c_str(), bondedAddr.toString().c_str());
}

void test_scan_and_bond() {
    NimBLEDevice::init("ESP32-Keyboard-Test");
    NimBLEScan *pScan = NimBLEDevice::getScan();
    pScan->setActiveScan(true);
    pScan->setInterval(80);
    pScan->setWindow(40);

    pScan->start(SCAN_DURATION_SEC, false);
    NimBLEScanResults results = pScan->getResults();

    bool foundM7 = false;
    for (int i = 0; i < results.getCount(); i++) {
        const NimBLEAdvertisedDevice *advDev = results.getDevice(i);
        if (advDev && advDev->getName() == "M7") {
            foundM7 = true;
            break;
        }
    }
    TEST_ASSERT_TRUE_MESSAGE(foundM7, "Keyboard M7 not found in scan");
}

void test_connect_to_keyboard() {
    hasBondedAddr = loadBondedAddress();
    TEST_ASSERT_TRUE_MESSAGE(hasBondedAddr, "No bonded address stored, run bonding test first");

    pClient = NimBLEDevice::createClient();
    pClient->setConnectTimeout(10000);
    bool result = pClient->connect(bondedAddr);

    TEST_ASSERT_TRUE_MESSAGE(result, "Failed to connect to bonded keyboard");
}

void setup() {
    Serial.begin(115200);
    UNITY_BEGIN();

    RUN_TEST(test_load_and_save_bonded_address);
    RUN_TEST(test_scan_and_bond);
    RUN_TEST(test_connect_to_keyboard);

    UNITY_END();
}

void loop() {
    // Not used for unit tests
}

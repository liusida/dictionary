#include <Arduino.h>
#include <NimBLEDevice.h>

// ==== Globals ====
constexpr int scanTime = 5000;
NimBLEScan *pBLEScan = nullptr;
NimBLEAdvertisedDevice *m7Device = nullptr;
NimBLEClient *pClient = nullptr;
const bool keyDebug = false;

char hidKeycodeToChar(uint8_t code, bool shift);
void printRawReport(const uint8_t *data, size_t length);
bool connectAndSubscribe(NimBLEAdvertisedDevice *dev);
void onKeypressNotify(NimBLERemoteCharacteristic *chr, uint8_t *data, size_t len, bool isNotify);
void startScan();

class ClientCallbacks : public NimBLEClientCallbacks
{
public:
  void onConnect(NimBLEClient *client) override
  {
    Serial.println("✅ Connected to M7!");
  }

  void onDisconnect(NimBLEClient *client, int reason) override
  {
    Serial.printf("❌ Disconnected. Reason: %d\n", reason);
  }
};

// ==== Scanning ====
class ScanCallbacks : public NimBLEScanCallbacks
{
  void onResult(const NimBLEAdvertisedDevice *dev) override
  {
    if (dev->haveName())
    {
      Serial.printf("🔎 Found: %s\n", dev->getName().c_str());

      if (dev->getName() == "M7")
      {
        Serial.printf("✅ M7 Found! Address: %s\n", dev->getAddress().toString().c_str());
        pBLEScan->stop();
        delete m7Device;
        m7Device = new NimBLEAdvertisedDevice(*dev);
      }
    }
  }
};

// ==== HID Decode ====
char hidKeycodeToChar(uint8_t code, bool shift = false)
{
  static const char unshifted[128] = {
      0, 0, 0, 0, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l',
      'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '\n', 0, 0, '\t', ' ',
      '-', '=', '[', ']', '\\', '#', ';', '\'', '`', ',', '.', '/'};

  if (code == 0x2A)
    return '\b'; // Backspace
  if (code < sizeof(unshifted))
  {
    char ch = unshifted[code];
    return (shift && ch >= 'a' && ch <= 'z') ? ch - 32 : ch;
  }
  return '?';
}

void printRawReport(const uint8_t *data, size_t length)
{
  Serial.print("🔔 Keypress data (raw): ");
  for (size_t i = 0; i < length; ++i)
  {
    Serial.printf("%02X ", data[i]);
  }
  Serial.println();
}

void onKeypressNotify(NimBLERemoteCharacteristic *chr, uint8_t *data, size_t len, bool isNotify)
{
  if (keyDebug)
  {
    printRawReport(data, len);
  }

  if (len < 3)
    return;

  uint8_t mod = data[0];
  bool shift = mod & 0x22;

  for (int i = 2; i < 8; ++i)
  {
    uint8_t code = data[i];
    if (code)
    {
      char ch = hidKeycodeToChar(code, shift);
      if (keyDebug)
      {
        Serial.printf("🔤 Key: %c (code: 0x%02X)\n", ch, code);
      }
      else
      {
        Serial.print(ch);
      }
    }
  }
}

// ==== Connection Logic ====
bool connectAndSubscribe(NimBLEAdvertisedDevice *dev)
{
  if (!dev)
    return false;

  if (!pClient)
  {
    pClient = NimBLEDevice::createClient();
    pClient->setClientCallbacks(new ClientCallbacks());
  }

  Serial.println("🔌 Connecting...");
  if (!pClient->connect(dev))
  {
    Serial.println("❌ Connection failed.");
    NimBLEDevice::deleteClient(pClient);
    pClient = nullptr;
    return false;
  }

  if (!pClient->discoverAttributes())
  {
    Serial.println("❌ Discovery failed.");
    pClient->disconnect();
    return false;
  }

  NimBLERemoteService *hid = pClient->getService("1812");
  if (!hid)
  {
    Serial.println("❌ HID service missing.");
    pClient->disconnect();
    return false;
  }

  NimBLERemoteCharacteristic *inputChar = nullptr;
  for (auto *chr : hid->getCharacteristics())
  {
    if (chr->canNotify())
    {
      inputChar = chr;
      break;
    }
  }

  if (!inputChar || !inputChar->subscribe(true, onKeypressNotify))
  {
    Serial.println("❌ Subscription failed.");
    pClient->disconnect();
    return false;
  }

  Serial.println("📬 Subscribed to HID input.");
  NimBLERemoteCharacteristic *ctrlPoint = hid->getCharacteristic("2A4C");
  if (ctrlPoint && ctrlPoint->canWrite())
  {
    uint8_t zero = 0x00;
    ctrlPoint->writeValue(&zero, 1, false);
    Serial.println("📤 Wrote 0x00 to HID Control Point");
  }
  return true;
}

void startScan()
{
  if (!pBLEScan)
  {
    pBLEScan = NimBLEDevice::getScan();
    pBLEScan->setScanCallbacks(new ScanCallbacks());
    pBLEScan->setActiveScan(true);
    pBLEScan->setInterval(100);
    pBLEScan->setWindow(80);
    pBLEScan->setDuplicateFilter(true);
  }

  Serial.println("🔍 Scanning for M7...");
  NimBLEScanResults results = pBLEScan->getResults(scanTime, false);
  Serial.printf("🔍 Scan complete. Found: %d device(s)\n", results.getCount());
  pBLEScan->clearResults();
}

void setup()
{
  Serial.begin(115200);
  NimBLEDevice::init("ESP32-Host");
}

void loop()
{
  // Nothing needed — everything runs via callbacks
  if (!m7Device)
  {
    startScan();
    delay(1000);
    return;
  }
  if (!pClient || !pClient->isConnected())
  {
    Serial.println("🔁 Client not connected. Attempting reconnect...");
    if (!connectAndSubscribe(m7Device))
    {
      Serial.println("⚠️ Reconnect failed. Resetting device reference.");
      delete m7Device;
      m7Device = nullptr;
    }
    delay(1000);
    return;
  }

  static unsigned long lastPing = 0;
  if (millis() - lastPing > 30000 && pClient && pClient->isConnected())
  {
    lastPing = millis();

    // Ping a known characteristic — e.g., Device Info (0x180A) if available
    NimBLERemoteService *devInfo = pClient->getService("180A");
    if (devInfo)
    {
      auto *ch = devInfo->getCharacteristic("2A29"); // Manufacturer Name
      if (ch && ch->canRead())
      {
        std::string val = ch->readValue();
        if (keyDebug)
        {
          Serial.print("📡 Keep-alive ping: ");
          Serial.println(val.c_str());
        }
      }
    }
  }

  delay(1000);
}

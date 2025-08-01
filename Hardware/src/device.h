#ifndef DEVICE_H
#define DEVICE_H

class Device {
protected:
    bool initialized = false;

public:
    Device() = default;
    bool isInitialized() const { return initialized; }
    void init() { initialized = true; }
};

#endif

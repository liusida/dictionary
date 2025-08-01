#ifndef MANAGE_SOUND_H
#define MANAGE_SOUND_H

#include <Arduino.h>
#include <driver/i2s.h>
#include "loggable.h"
#include "device.h"
#include "pins.h"

class ManageSound : public Loggable, public Device {
public:
    ManageSound(Stream *logOutput = nullptr);
    void init(int bclkPin, int lrcPin, int dinPin, int sdPin=-1, int sampleRate = 44100);
    void playTestTone(float frequency = 1000.0, int durationMs = 500, int loudness = 16000);

private:
    int _sampleRate;
    i2s_port_t _i2sPort;
    void stop();
};

#endif // MANAGE_SOUND_H

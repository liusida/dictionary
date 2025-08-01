#ifndef MANAGE_OLED_H
#define MANAGE_OLED_H

#include <Arduino.h>
#include <U8g2lib.h>

#include "loggable.h"
#include "device.h"
#include "pins.h"

extern const uint8_t *FONTS[];
extern const int NUM_FONTS;

class ManageOLED : public Loggable, public Device
{

public:
    ManageOLED(Stream *logOutput = nullptr);
    void init();
    void print(const char *str);

private:
    int selectFittingFont(const char *text);
    void renderDisplay();

private:
    U8G2_SH1122_256X64_F_4W_HW_SPI u8g2;
    String currentBuffer; // stores text for rendering
};

#endif
#ifndef MANAGE_EPAPER_H
#define MANAGE_EPAPER_H

#include <Arduino.h>
#include <Adafruit_GFX.h>

#include <GxEPD2_BW.h>
// #include <GxEPD2_3C.h>
#include "gdey/GxEPD2_420_GDEY042T81.h"
// #include "gdey3c/GxEPD2_420c_GDEY042Z98.h"
// #include <Fonts/FreeSans24pt7b.h>
// #include <Fonts/FreeSansBold18pt7b.h>
// #include <Fonts/FreeSansBold12pt7b.h>
// #include <Fonts/FreeSans12pt7b.h>
// #include <Fonts/FreeSans9pt7b.h>

// #include <Fonts/FreeSerifBold12pt7b.h>
// #include <Fonts/FreeSerif9pt7b.h>
// #include <Fonts/FreeSerifItalic9pt7b.h>

#include "NotoFont/NotoSerif_Bold12pt7b.h"
#include "NotoFont/NotoSerif_Italic9pt7b.h"
#include "NotoFont/NotoSerif_Regular9pt7b.h"

#include "loggable.h"
#include "pins.h"

class ManageEPaper : public Loggable
{
public:
    ManageEPaper(Stream *logOutput = nullptr);
    void init();
    // void printWord(const char *str);
    void setWord(const char *str) { word = str; }
    void setExplanation(const char *str) { explanation = str; }
    void setSampleSentence(const char *str) { samplesentence = str; }
    void draw();
    void clear();
    int16_t printTextInBox(
        const String &text,
        int16_t x, int16_t y,
        int16_t boxWidth, int16_t boxHeight,
        const GFXfont *font,
        float lineHeight = 1.1,
        float spaceWidthScale = 0.8,
        bool highlightWord = false);

private:
    GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT> display_bw;

    String word;
    String explanation;
    String samplesentence;
};

#endif
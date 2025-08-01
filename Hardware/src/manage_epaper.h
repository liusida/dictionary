#ifndef MANAGE_EPAPER_H
#define MANAGE_EPAPER_H

#include <Arduino.h>
#include <Adafruit_GFX.h>

// #include <GxEPD2_4G_4G.h>
// #include <GxEPD2_4G_BW.h>
#include <GxEPD2_BW.h>
// #include <GxEPD2_3C.h>
#include "gdey/GxEPD2_420_GDEY042T81.h"
// #include "gdey3c/GxEPD2_420c_GDEY042Z98.h"
// #include <Fonts/FreeSans24pt7b.h>
// #include <Fonts/FreeSansBold18pt7b.h>
// #include <Fonts/FreeSansBold12pt7b.h>
// #include <Fonts/FreeSans12pt7b.h>
// #include <Fonts/FreeSans9pt7b.h>

#include <Fonts/FreeSerifBold12pt7b.h>
#include <Fonts/FreeSerif12pt7b.h>
#include <Fonts/FreeSerifItalic12pt7b.h>
#define WordFont FreeSerifBold12pt7b
#define ExplanationFont FreeSerif12pt7b
#define SampleSentenceFont FreeSerifItalic12pt7b

// #include "NotoFont/NotoSerif_Bold12pt7b.h"
// #include "NotoFont/NotoSerif_Italic9pt7b.h"
// #include "NotoFont/NotoSerif_Regular9pt7b.h"

// #include <Fonts/FreeMonoBold12pt7b.h>
// #include <Fonts/FreeMono9pt7b.h>
// #include <Fonts/FreeMonoOblique9pt7b.h>
// #define WordFont FreeMonoBold12pt7b
// #define ExplanationFont FreeMono9pt7b
// #define SampleSentenceFont FreeMono9pt7b


#include "loggable.h"
#include "device.h"
#include "pins.h"

#define GxEPD2_DRIVER_CLASS GxEPD2_420_GDEY042T81 // GDEY042T81 400x300, SSD1683 (no inking)

class ManageEPaper : public Loggable, public Device
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
    GxEPD2_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT> display;
    // #define MAX_DISPLAY_BUFFER_SIZE 65536ul // e.g.
    // #define MAX_HEIGHT_BW(EPD) (EPD::HEIGHT <= (MAX_DISPLAY_BUFFER_SIZE / 2) / (EPD::WIDTH / 8) ? EPD::HEIGHT : (MAX_DISPLAY_BUFFER_SIZE / 2) / (EPD::WIDTH / 8))
    // #define MAX_HEIGHT_4G(EPD) (EPD::HEIGHT <= (MAX_DISPLAY_BUFFER_SIZE / 2) / (EPD::WIDTH / 4) ? EPD::HEIGHT : (MAX_DISPLAY_BUFFER_SIZE / 2) / (EPD::WIDTH / 4))
    // // adapt the constructor parameters to your wiring
    // GxEPD2_4G_4G<GxEPD2_DRIVER_CLASS, MAX_HEIGHT_4G(GxEPD2_DRIVER_CLASS)> display;
    // GxEPD2_4G_BW_R<GxEPD2_DRIVER_CLASS, MAX_HEIGHT_BW(GxEPD2_DRIVER_CLASS)> display_bw;
    // #undef MAX_DISPLAY_BUFFER_SIZE
    // #undef MAX_HEIGHT_BW
    // #undef MAX_HEIGHT_4G
    
    String word;
    String explanation;
    String samplesentence;
    int draw_count;
};

#endif
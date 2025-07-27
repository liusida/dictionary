#include "manage_oled.h"

const uint8_t *FONTS[] = {
    u8g2_font_fub42_tr, // ~42 px
    u8g2_font_fub35_tr, // ~35 px
    u8g2_font_fub30_tr, // ~30 px
    u8g2_font_fub25_tr, // ~25 px
    u8g2_font_fub17_tr, // ~17 px
    u8g2_font_fub11_tr, // ~11 px
    u8g2_font_5x8_mf    // fallback small
};

const int NUM_FONTS = sizeof(FONTS) / sizeof(FONTS[0]);

ManageOLED::ManageOLED(Stream *logOutput)
    : Loggable(logOutput), u8g2(U8G2_SH1122_256X64_F_4W_HW_SPI(U8G2_R0, PIN_OLED_CS, PIN_OLED_DC, PIN_OLED_RST))
{
}

void ManageOLED::init()
{
    log("Setup OLED.");
    u8g2.begin();
    u8g2.setFont(FONTS[0]);
    this->print("Initializing OLED...");
}

void ManageOLED::print(const char *str)
{
    currentBuffer = str; // store text
    renderDisplay();     // draw automatically
}

int ManageOLED::selectFittingFont(const char *text)
{
    int displayWidth = u8g2.getDisplayWidth();
    for (int i = 0; i < NUM_FONTS; ++i)
    {
        u8g2.setFont(FONTS[i]);             // ✅ set font first
        int width = u8g2.getStrWidth(text); // ✅ measure width with that font
        if (width <= displayWidth)
            return i;
    }
    return NUM_FONTS - 1;
}

void ManageOLED::renderDisplay()
{
    int displayWidth = u8g2.getDisplayWidth();
    const char *text = currentBuffer.c_str();
    int fontIndex = selectFittingFont(text);

    u8g2.setFont(FONTS[fontIndex]);
    int textWidth = u8g2.getStrWidth(text);
    int x = (textWidth < displayWidth) ? (displayWidth - textWidth) / 2 : 0;

    int ascent = u8g2.getAscent();
    int descent = u8g2.getDescent(); // negative
    int textHeight = ascent - descent;

    int baselineY = (64 - textHeight) / 2 + ascent;

    u8g2.clearBuffer();
    u8g2.drawStr(x, baselineY, text);
    u8g2.sendBuffer();
}

#include "manage_epaper.h"

ManageEPaper::ManageEPaper(Stream *logOutput)
    : Loggable(logOutput), display_bw(GxEPD2_420_GDEY042T81(PIN_EPAPER_CS, PIN_EPAPER_DC, PIN_EPAPER_RST, PIN_EPAPER_BUSY))
{
}

void ManageEPaper::init()
{
    Serial0.println("Setup E-paper.");
    display_bw.init();
    display_bw.setTextWrap(false);
    display_bw.setRotation(0);
}

void ManageEPaper::draw()
{
    int16_t y;
    display_bw.firstPage();
    do
    {
        display_bw.setTextColor(GxEPD_BLACK);
        y = 30;
        y = printTextInBox(word, 20, y, 360, 300-y, &NotoSerif_Bold12pt7b); // use all the remaining space.
        y = printTextInBox(explanation, 20, y, 360, 300-y, &NotoSerif_Regular9pt7b); // use all the remaining space.
        y += 5;
        y = printTextInBox(samplesentence, 20, y, 360, 300-y, &NotoSerif_Italic9pt7b, 1.1F, 0.8F, true); // use all the remaining space.

    } while (display_bw.nextPage());
}

void ManageEPaper::clear()
{
    display_bw.firstPage();
    do
    {
        display_bw.fillScreen(GxEPD_WHITE);
    } while (display_bw.nextPage());
}

int16_t ManageEPaper::printTextInBox(
    const String &text,
    int16_t x, int16_t y,
    int16_t boxWidth, int16_t boxHeight,
    const GFXfont *font,
    float lineHeightScale,   // 1.0 = 100% of font height
    float spaceWidthScale,
    bool highlightWord)   // 1.0 = 100% of space glyph width
{
    display_bw.setTextWrap(false);
    display_bw.setFont(font);
    display_bw.setTextColor(GxEPD_BLACK);

    int16_t cursorX = x;
    int16_t cursorY = y;

    uint16_t w, h;
    int16_t tmpX, tmpY;

    // Base line height
    int16_t baseLineHeight = font->yAdvance;
    int16_t lineHeightPx = (int16_t)(baseLineHeight * lineHeightScale);

    // Measure the width of a space character
    display_bw.getTextBounds("a", cursorX, cursorY, &tmpX, &tmpY, &w, &h);
    int16_t spaceWidthPx = (int16_t)(w * spaceWidthScale);
    bool insideTag = false;

    String wordBuffer;
    for (uint16_t i = 0; i <= text.length(); i++)
    {
        char c = (i < text.length()) ? text[i] : ' ';

        // Detect HTML-like tags
        if (c == '<') { insideTag = true; continue; }
        if (c == '>') { insideTag = false; continue; }
        if (insideTag) continue; // skip all tag characters

        if (c == ' ' || c == '\n' || i == text.length())
        {
            if (wordBuffer.length() > 0)
            {
                display_bw.getTextBounds(wordBuffer.c_str(), cursorX, cursorY, &tmpX, &tmpY, &w, &h);

                // Check wrapping
                if (cursorX + w > x + boxWidth)
                {
                    cursorX = x;
                    cursorY += lineHeightPx;
                }

                // Stop if text goes beyond the box
                if (cursorY + h > y + boxHeight)
                    break;

                display_bw.setCursor(cursorX, cursorY);
                display_bw.print(wordBuffer);

                // Underline if it matches this->word
                if (highlightWord && wordBuffer == this->word)
                {
                    int16_t underlineY = cursorY + 2; // adjust if needed
                    display_bw.drawLine(cursorX, underlineY,
                                        cursorX + w, underlineY, GxEPD_BLACK);
                }
                
                cursorX = display_bw.getCursorX() + spaceWidthPx; // scaled space
                wordBuffer = "";
            }

            if (c == '\n')
            {
                cursorX = x;
                cursorY += lineHeightPx;
            }
        }
        else
        {
            wordBuffer += c;
        }
    }
    return cursorY + lineHeightPx;
}

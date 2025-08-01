#include "manage_epaper.h"

ManageEPaper::ManageEPaper(Stream *logOutput)
    : Loggable(logOutput),
    display(GxEPD2_DRIVER_CLASS(/*CS=5*/ PIN_EPAPER_CS, /*DC=*/ PIN_EPAPER_DC, /*RST=*/ PIN_EPAPER_RST, /*BUSY=*/ PIN_EPAPER_BUSY)),
    draw_count(0)
{
}

void ManageEPaper::init()
{
    log("Setup E-paper.");
    display.init(115200);

    log("E-paper display initialized.");
    display.setTextWrap(false);
    display.setRotation(0);
    Device::init();
}

void ManageEPaper::draw()
{
    draw_count++;
    int16_t y;
    if (draw_count%5==0) {
        display.setFullWindow();
    } else {
        display.setPartialWindow(0, 0, 400, 300);
    }
    display.firstPage();
    do
    {
        display.setTextColor(GxEPD_DARKGREY);
        y = 20;
        y = printTextInBox(word, 5, y, 395, 300-y, &WordFont); // use all the remaining space.
        display.setTextColor(GxEPD_BLACK);
        y = printTextInBox(explanation, 5, y, 395, 300-y, &ExplanationFont); // use all the remaining space.
        // y += 5;
        display.setTextColor(GxEPD_DARKGREY);
        y = printTextInBox(samplesentence, 5, y, 395, 300-y, &SampleSentenceFont, 1.1F, 0.8F, true); // use all the remaining space.

    } while (display.nextPage());
}

void ManageEPaper::clear()
{
    display.firstPage();
    do
    {
        display.fillScreen(GxEPD_WHITE);
    } while (display.nextPage());
    draw_count = 0;
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
    display.setTextWrap(false);
    display.setFont(font);
    display.setTextColor(GxEPD_BLACK);

    int16_t cursorX = x;
    int16_t cursorY = y;

    uint16_t w, h;
    int16_t tmpX, tmpY;

    // Base line height
    int16_t baseLineHeight = font->yAdvance;
    int16_t lineHeightPx = (int16_t)(baseLineHeight * lineHeightScale);

    // Measure the width of a space character
    display.getTextBounds("a", cursorX, cursorY, &tmpX, &tmpY, &w, &h);
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
                display.getTextBounds(wordBuffer.c_str(), cursorX, cursorY, &tmpX, &tmpY, &w, &h);

                // Check wrapping
                if (cursorX + w > x + boxWidth)
                {
                    cursorX = x;
                    cursorY += lineHeightPx;
                }

                // Stop if text goes beyond the box
                if (cursorX == x && cursorY + h > y + boxHeight)
                    break;

                display.setCursor(cursorX, cursorY);
                display.print(wordBuffer);

                // Underline if it matches this->word
                if (highlightWord && wordBuffer == this->word)
                {
                    int16_t underlineY = cursorY + 2; // adjust if needed
                    display.drawLine(cursorX, underlineY,
                                        cursorX + w, underlineY, GxEPD_BLACK);
                }
                
                cursorX = display.getCursorX() + spaceWidthPx; // scaled space
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

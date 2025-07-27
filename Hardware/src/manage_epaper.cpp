#include "manage_epaper.h"

ManageEPaper::ManageEPaper(Stream *logOutput)
    : Loggable(logOutput), display_bw(GxEPD2_420_GDEY042T81(PIN_EPAPER_CS, PIN_EPAPER_DC, PIN_EPAPER_RST, PIN_EPAPER_BUSY))
{
}

void ManageEPaper::init()
{
    Serial0.println("Setup E-paper.");
    display_bw.init();
    display_bw.setRotation(0);
}

void ManageEPaper::draw()
{
    display_bw.firstPage();
    do
    {
        display_bw.setTextColor(GxEPD_BLACK);
        display_bw.setFont(&FreeSansBold18pt7b);
        display_bw.setCursor(20, 50);
        display_bw.print(word);

        display_bw.setFont(&FreeSans12pt7b);
        display_bw.setCursor(20, 100);
        display_bw.print(explanation);

        display_bw.setCursor(20, 150);
        display_bw.print(samplesentence);
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
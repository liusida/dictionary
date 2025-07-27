#include <Arduino.h>
#include <unity.h>

#include <GxEPD2_4G_BW.h>
#include <Fonts/FreeMonoBold9pt7b.h>
#include "pins.h"

// Instantiate the display (replace with your actual pin numbers)
GxEPD2_4G_BW<GxEPD2_420_GDEY042T81, GxEPD2_420_GDEY042T81::HEIGHT> display(
    GxEPD2_420_GDEY042T81(PIN_EPAPER_CS, PIN_EPAPER_DC, PIN_EPAPER_RST, PIN_EPAPER_BUSY));

void test_display_hello_world()
{
    Serial0.println("[TEST] Initializing display...");
    display.init(115200); // init with debug output
    display.setRotation(1);
    display.setFullWindow();

    // Prepare text bounds for centering
    const char hello[] = "Hello World!";
    int16_t tbx, tby;
    uint16_t tbw, tbh;
    display.setFont(&FreeMonoBold9pt7b);
    display.getTextBounds(hello, 0, 0, &tbx, &tby, &tbw, &tbh);
    uint16_t x = ((display.width() - tbw) / 2) - tbx;
    uint16_t y = ((display.height() - tbh) / 2) - tby;

    Serial0.println("[TEST] Drawing text...");
    display.firstPage();
    do
    {
        display.fillScreen(GxEPD_WHITE);
        display.setCursor(x, y);
        display.print(hello);
    } while (display.nextPage());

    Serial0.println("[TEST] Done drawing!");
    // We cannot really assert on the e-paper output
    // TEST_PASS_MESSAGE("Drew 'Hello World!' on the display");
}

void setup()
{
    Serial0.begin(115200);
    delay(2000); // Give some time for serial to open

    UNITY_BEGIN();
    RUN_TEST(test_display_hello_world);
    UNITY_END();
}

void loop() {}

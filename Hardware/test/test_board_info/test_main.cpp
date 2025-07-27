#include <Arduino.h>
#include <unity.h>
#include "esp_heap_caps.h"

// Utility to print PSRAM info
void print_board_info() {
  Serial0.printf("Chip model: %s\n", ESP.getChipModel());
  Serial0.printf("Flash size: %d MB\n", ESP.getFlashChipSize() / (1024 * 1024));

  if (psramFound()) {
    Serial0.println("✓ PSRAM found and initialized");
    Serial0.printf("Total PSRAM: %u bytes (%.1f MB)\n",
                   ESP.getPsramSize(),
                   ESP.getPsramSize() / (1024.0 * 1024.0));
    Serial0.printf("Free PSRAM: %u bytes\n", ESP.getFreePsram());
  } else {
    Serial0.println("✗ PSRAM NOT found");
  }
}

void test_board_info_runs() {
  TEST_PASS();  // Always pass, we just report info
}

void setup() {
  Serial0.begin(115200);
  delay(2000);            // allow USB/serial to reconnect
  UNITY_BEGIN();
  print_board_info();
  RUN_TEST(test_board_info_runs);
  UNITY_END();
}

void loop() { }

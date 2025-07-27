#include <Arduino.h>
#include "esp_heap_caps.h"
#include <unity.h>

void test_max_psram_allocation() {
  const size_t START_SIZE = 8256512;
  const size_t STEP_SIZE = 256;
  const size_t MAX_EXTRA = 16384;

  size_t last_success = 0;

  for (size_t extra = 0; extra <= MAX_EXTRA; extra += STEP_SIZE) {
    size_t size = START_SIZE + extra;
    void* ptr = heap_caps_malloc(size, MALLOC_CAP_SPIRAM);

    if (ptr) {
      last_success = size;
      heap_caps_free(ptr);
    } else {
      break;
    }
  }

  // Make sure we reached close to 8MB
  Serial.printf("Last success: %u bytes PSRAM.\n", last_success);
  Serial0.printf("Last success: %u bytes PSRAM.\n", last_success);
  TEST_ASSERT_GREATER_THAN(7 * 1024 * 1024, last_success);
  TEST_ASSERT_LESS_THAN(8388608, last_success + STEP_SIZE);
}

void setup() {
  Serial0.begin(115200);
  delay(1000);
  UNITY_BEGIN();
  RUN_TEST(test_max_psram_allocation);
  UNITY_END();
}

void loop() {}
